import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountStore } from '../src/cloudStore.js';
import type { SupabaseLike } from '../src/cloudStore.js';
import { createDeviceStore, createHostStore } from '../src/deviceStore.js';
import type { StorageLike } from '../src/deviceStore.js';
import { FLEET_SETTINGS } from '../src/fleet.js';
import { createSettingsStore } from '../src/store.js';

/**
 * Review S-07: a listener that throws must not undo, or fail, a change that
 * has already been saved. Each listener is called on its own, and its error
 * is reported rather than handed back to whoever made the change.
 */

function storage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function server() {
  const merged: Array<Record<string, unknown>> = [];
  const api: SupabaseLike = {
    from: () => ({
      select: () => ({ match: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      update: () => ({ match: async () => ({ error: null }) }),
    }),
    rpc: async (_fn: string, args?: Record<string, unknown>) => {
      merged.push(args ?? {});
      return { data: null, error: null };
    },
  };
  return { api, merged };
}

const boom = () => {
  throw new Error('listener failed');
};

let reported: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  reported.mockRestore();
});

describe('a throwing listener on a cloud layer', () => {
  it('neither rolls back nor fails a set the server accepted', async () => {
    const { api, merged } = server();
    const account = createAccountStore(api, 'user-1');
    await account.load();
    const after = vi.fn();
    account.subscribe!(boom);
    account.subscribe!(after);

    await expect(account.set('vhf.retention_days', '14')).resolves.toBeUndefined();

    expect(account.get('vhf.retention_days')).toBe('14');
    expect(merged).toHaveLength(1);
    expect(after).toHaveBeenCalled();
    expect(reported).toHaveBeenCalled();
  });

  it('does not turn a load into a failed one', async () => {
    const { api } = server();
    const account = createAccountStore(api, 'user-1');
    account.subscribe!(boom);
    await expect(account.load()).resolves.toBe(false);
    expect(account.loaded).toBe(true);
  });

  it('does not stop a reset', () => {
    const { api } = server();
    const account = createAccountStore(api, 'user-1');
    account.subscribe!(boom);
    expect(() => account.reset()).not.toThrow();
  });
});

describe('a throwing listener on the settings store', () => {
  it('does not fail or undo an account write', async () => {
    const { api } = server();
    const account = createAccountStore(api, 'user-1');
    await account.load();
    const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [account] });
    const after = vi.fn();
    settings.subscribe(boom);
    settings.subscribe(after);

    await expect(settings.set('vhf.retention_days', 14, { scope: 'account' })).resolves.toBeUndefined();

    expect(settings.get('vhf.retention_days')).toBe(14);
    expect(settings.source('vhf.retention_days')).toBe('account');
    expect(after).toHaveBeenCalled();
    expect(reported).toHaveBeenCalled();
  });

  it('does not fail a device write or a clear', async () => {
    const store = storage();
    const device = createDeviceStore(store, { app: 'ocean', registry: FLEET_SETTINGS });
    const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [device] });
    settings.subscribe(boom);

    await expect(settings.set('display.night_brightness', 40, { scope: 'device' })).resolves.toBeUndefined();
    expect(settings.get('display.night_brightness')).toBe(40);
    await expect(settings.clear('display.night_brightness', 'device')).resolves.toBeUndefined();
    expect(settings.isSetAt('display.night_brightness', 'device')).toBe(false);
  });
});

describe('a throwing listener on a device or host layer', () => {
  it('is reported and the others are still told', () => {
    for (const layer of [
      createDeviceStore(storage(), { app: 'ocean', registry: FLEET_SETTINGS }),
      createHostStore(storage()),
    ]) {
      const after = vi.fn();
      layer.subscribe!(boom);
      layer.subscribe!(after);
      expect(() => layer.notifyExternalChange()).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
    }
    expect(reported).toHaveBeenCalledTimes(2);
  });
});
