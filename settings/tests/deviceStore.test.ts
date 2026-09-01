import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../src/deviceStore.js';
import { createRegistry, defineSetting } from '../src/registry.js';
import { createSettingsStore } from '../src/store.js';
import { boolType, intType } from '../src/valueTypes.js';
import type { StorageLike } from '../src/deviceStore.js';

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const registry = createRegistry({
  'display.keep_awake': defineSetting({
    scopes: ['device'],
    type: boolType,
    default: false,
    label: 'Keep awake',
    legacy: { harbor: ['harbor_sentinel_keep_awake'], ocean: ['ocean_sentinel_keep_awake'] },
  }),
  'display.night_brightness': defineSetting({
    scopes: ['device'],
    type: intType({ min: 10, max: 100 }),
    default: 60,
    label: 'Night brightness',
    legacy: { harbor: ['night_brightness'], ocean: ['night_brightness'] },
  }),
  'display.auto_dim': defineSetting({
    scopes: ['device'],
    type: boolType,
    default: false,
    label: 'Dim when idle',
  }),
});

describe('namespacing', () => {
  it('writes under one prefix, so settings stop sharing a namespace with cached data', () => {
    const storage = memoryStorage({ vessel_passages: '[]', oauth_provider_token: 'secret' });
    const store = createDeviceStore(storage, { app: 'ocean', registry });

    store.set('display.auto_dim', 'true');

    expect(storage.map.get('sentinel.display.auto_dim')).toBe('true');
    expect(storage.map.get('vessel_passages')).toBe('[]');
    expect([...storage.map.keys()].filter((key) => key.startsWith('sentinel.'))).toEqual(['sentinel.display.auto_dim']);
  });
});

describe('legacy keys', () => {
  it('reads the value a person already set, under the old name', () => {
    const store = createDeviceStore(memoryStorage({ harbor_sentinel_keep_awake: 'true' }), {
      app: 'harbor',
      registry,
    });
    expect(store.get('display.keep_awake')).toBe('true');
  });

  it('looks up the right name per app for a setting the two apps named differently', () => {
    const seed = { ocean_sentinel_keep_awake: 'true' };
    expect(createDeviceStore(memoryStorage(seed), { app: 'ocean', registry }).get('display.keep_awake')).toBe('true');
    // HarborSentinel must not read OceanSentinel's key name.
    expect(createDeviceStore(memoryStorage(seed), { app: 'harbor', registry }).get('display.keep_awake')).toBeUndefined();
  });

  it('prefers the namespaced value once one exists', () => {
    const store = createDeviceStore(
      memoryStorage({ 'sentinel.display.night_brightness': '40', night_brightness: '90' }),
      { app: 'harbor', registry }
    );
    expect(store.get('display.night_brightness')).toBe('40');
  });

  it('does not write anything back on a read', () => {
    // Migration is an explicit step. A read that quietly rewrites a person's
    // storage is a surprise, and makes the before/after state untestable.
    const storage = memoryStorage({ night_brightness: '90' });
    const store = createDeviceStore(storage, { app: 'harbor', registry });

    store.get('display.night_brightness');

    expect(storage.map.has('sentinel.display.night_brightness')).toBe(false);
    expect([...storage.map.keys()]).toEqual(['night_brightness']);
  });

  it('clears the legacy name too, or the override would come straight back', () => {
    const storage = memoryStorage({ 'sentinel.display.keep_awake': 'false', harbor_sentinel_keep_awake: 'true' });
    const store = createDeviceStore(storage, { app: 'harbor', registry });

    store.clear('display.keep_awake');

    expect(store.get('display.keep_awake')).toBeUndefined();
    expect(storage.map.size).toBe(0);
  });

  it('ignores an undeclared key rather than throwing', () => {
    const store = createDeviceStore(memoryStorage(), { app: 'harbor', registry });
    expect(store.get('not.declared')).toBeUndefined();
  });
});

describe('hostile storage', () => {
  const throwing: StorageLike = {
    getItem() {
      throw new Error('SecurityError: storage disabled');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {
      throw new Error('SecurityError: storage disabled');
    },
  };

  it('reads, writes and clears without throwing', () => {
    const store = createDeviceStore(throwing, { app: 'ocean', registry });
    expect(() => store.get('display.keep_awake')).not.toThrow();
    expect(store.get('display.keep_awake')).toBeUndefined();
    expect(() => store.set('display.keep_awake', 'true')).not.toThrow();
    expect(() => store.clear('display.keep_awake')).not.toThrow();
  });

  it('still resolves declared defaults through the settings store', () => {
    const settings = createSettingsStore({
      registry,
      stores: [createDeviceStore(throwing, { app: 'ocean', registry })],
    });
    expect(settings.get('display.night_brightness')).toBe(60);
  });
});

describe('external change', () => {
  it('notifies subscribers when the host says storage moved underneath us', () => {
    const store = createDeviceStore(memoryStorage(), { app: 'ocean', registry });
    const listener = vi.fn();
    const unsubscribe = store.subscribe!(listener);

    store.notifyExternalChange();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.notifyExternalChange();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('end to end through the settings store', () => {
  it('reads a legacy value, then a written one, then falls back after a clear', async () => {
    const storage = memoryStorage({ harbor_sentinel_keep_awake: 'true' });
    const settings = createSettingsStore({
      registry,
      stores: [createDeviceStore(storage, { app: 'harbor', registry })],
    });

    // An upgraded device keeps what somebody had set, with no migration run yet.
    expect(settings.get('display.keep_awake')).toBe(true);

    await settings.set('display.keep_awake', false, { scope: 'device' });
    expect(settings.get('display.keep_awake')).toBe(false);

    await settings.clear('display.keep_awake', 'device');
    expect(settings.resolve('display.keep_awake')).toEqual({ value: false, source: 'default' });
  });
});
