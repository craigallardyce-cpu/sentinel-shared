import { describe, expect, it, vi } from 'vitest';
import { createAccountStore, createVesselStore } from '../src/cloudStore.js';
import { createDeviceStore } from '../src/deviceStore.js';
import { FLEET_SETTINGS } from '../src/fleet.js';
import { createSettingsStore } from '../src/store.js';
import type { SupabaseLike } from '../src/cloudStore.js';
import type { StorageLike } from '../src/deviceStore.js';

/**
 * A Supabase client that records what it was asked to do.
 *
 * Shaped from the real request/response pair rather than guessed: `select`
 * chains through `match` to `maybeSingle` and resolves `{ data, error }`, and
 * `rpc` resolves the same envelope.
 */
function fakeClient(
  rows: Record<string, Record<string, unknown> | null>,
  options: { failWrites?: boolean } = {}
) {
  const calls: Array<{ kind: string; table?: string; fn?: string; args?: unknown; payload?: unknown }> = [];
  const error = options.failWrites ? { message: 'permission denied' } : null;

  const client: SupabaseLike = {
    from(table: string) {
      return {
        select: () => ({
          match: () => ({
            maybeSingle: async () => {
              calls.push({ kind: 'select', table });
              return { data: rows[table] ?? null, error: null };
            },
          }),
        }),
        update: (payload: unknown) => ({
          match: async () => {
            calls.push({ kind: 'update', table, payload });
            return { error };
          },
        }),
      };
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ kind: 'rpc', fn, args });
      return { data: null, error };
    },
  };

  return { client, calls };
}

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * The live rows, as they read after the phase 2 migration.
 *
 * Configuration and identity are two tables on purpose: public.vessels is
 * publicly readable for the shared voyage pages, so the blob lives in
 * public.vessel_settings, which is owner-only.
 */
const ACCOUNT = {
  user_settings: { settings: { 'units.metric': 'false' } },
};
const VESSEL = {
  vessel_settings: {
    settings: {
      'nmea.source': 'NMEA LOCAL',
      'nmea.gateway.host': '192.168.86.33',
      'nmea.gateway.port': '10110',
      'nmea.datahub_url': 'http://192.168.86.33:10110',
      'vessel.bow_roller_height_ft': '5.5',
    },
  },
  vessels: { name: 'Saorsa', mmsi: '366895720', vessel_type: '' },
};

describe('loading', () => {
  it('answers nothing until it has loaded, so the first render is not blocked', async () => {
    const { client } = fakeClient(ACCOUNT);
    const store = createAccountStore(client, 'user-1');

    expect(store.loaded).toBe(false);
    expect(store.get('units.metric')).toBeUndefined();

    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.get('units.metric')).toBe('false');
  });

  it('reads the blob and the identity columns as one set of keys', async () => {
    const { client } = fakeClient(VESSEL);
    const store = createVesselStore(client);
    await store.load();

    expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
    expect(store.get('vessel.name')).toBe('Saorsa');
    expect(store.get('vessel.mmsi')).toBe('366895720');
    // An empty column is absence, the same as everywhere else.
    expect(store.get('vessel.type')).toBeUndefined();
  });

  it('does not reject when there is no row, no session, or no network', async () => {
    const { client } = fakeClient({});
    const store = createAccountStore(client, 'user-1');

    await expect(store.load()).resolves.toBe(false);
    expect(store.loaded).toBe(true);
    expect(store.get('units.metric')).toBeUndefined();
  });

  it('notifies subscribers once the values arrive', async () => {
    const { client } = fakeClient(ACCOUNT);
    const store = createAccountStore(client, 'user-1');
    const listener = vi.fn();
    store.subscribe!(listener);

    await store.load();

    expect(listener).toHaveBeenCalled();
  });
});

describe('writing', () => {
  it('merges in the database rather than sending back a blob it read', async () => {
    // Read-modify-write would lose whatever another device saved in between --
    // the same whole-document clobber POST /config had to be taught out of.
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client);
    await store.load();

    await store.set('nmea.gateway.port', '11102');

    const rpc = calls.find((call) => call.kind === 'rpc');
    expect(rpc?.fn).toBe('merge_vessel_settings');
    expect(rpc?.args).toEqual({ slug: 'sentinel', patch: { 'nmea.gateway.port': '11102' } });
    expect(store.get('nmea.gateway.port')).toBe('11102');
    // Nothing else was sent, so nothing else can be overwritten.
    expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
  });

  it('writes an identity key to the public vessels row, not into the blob', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client);
    await store.load();

    await store.set('vessel.name', 'Saorsaa');

    const update = calls.find((call) => call.kind === 'update');
    expect(update?.table).toBe('vessels');
    expect((update?.payload as Record<string, unknown>).name).toBe('Saorsaa');
    expect(calls.some((call) => call.kind === 'rpc')).toBe(false);
  });

  it('rolls back the cache when the write is refused', async () => {
    // Otherwise the screen shows a value nothing is holding, which is the exact
    // shape of "settings appear not to persist".
    const { client } = fakeClient(VESSEL, { failWrites: true });
    const store = createVesselStore(client);
    await store.load();

    await expect(store.set('nmea.gateway.host', '10.10.10.1')).rejects.toThrow(/permission denied/);
    expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
  });

  it('clears a blob key through the same merge function', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client);
    await store.load();

    await store.clear('nmea.datahub_url');

    const rpc = calls.find((call) => call.kind === 'rpc');
    expect(rpc?.args).toEqual({ slug: 'sentinel', remove_keys: ['nmea.datahub_url'] });
    expect(store.get('nmea.datahub_url')).toBeUndefined();
  });

  it('clears an identity key by nulling its column', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client);
    await store.load();

    await store.clear('vessel.mmsi');

    const update = calls.find((call) => call.kind === 'update');
    expect((update?.payload as Record<string, unknown>).mmsi).toBeNull();
  });
});

describe('the whole chain, against the live rows', () => {
  it('reads configuration and identity from their separate tables', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client);
    await store.load();

    expect(calls.filter((call) => call.kind === 'select').map((call) => call.table)).toEqual([
      'vessel_settings',
      'vessels',
    ]);
    expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
    expect(store.get('vessel.name')).toBe('Saorsa');
  });

  it('resolves each setting from the layer that owns it', async () => {
    const { client: accountClient } = fakeClient(ACCOUNT);
    const { client: vesselClient } = fakeClient(VESSEL);

    const account = createAccountStore(accountClient, 'user-1');
    const vessel = createVesselStore(vesselClient);
    const device = createDeviceStore(memoryStorage({ 'sentinel.display.night_brightness': '40' }), {
      app: 'harbor',
      registry: FLEET_SETTINGS,
    });

    const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [account, vessel, device] });
    await Promise.all([account.load(), vessel.load()]);

    expect(settings.resolve('units.metric')).toEqual({ value: false, source: 'account' });
    expect(settings.resolve('vessel.name')).toEqual({ value: 'Saorsa', source: 'vessel' });
    expect(settings.resolve('vessel.mmsi')).toEqual({ value: '366895720', source: 'vessel' });
    expect(settings.resolve('nmea.gateway.host')).toEqual({ value: '192.168.86.33', source: 'vessel' });
    expect(settings.resolve('nmea.gateway.port')).toEqual({ value: 10110, source: 'vessel' });
    expect(settings.resolve('display.night_brightness')).toEqual({ value: 40, source: 'device' });
    // Host-scoped, and no host store attached: the alarm tuning stays on-device,
    // which is why the cloud schema has no column for it.
    expect(settings.resolve('alarms.ais_proximity.limit_nm')).toEqual({ value: undefined, source: 'unset' });
  });

  it('lets a device override the boat without touching the boat', async () => {
    const { client: vesselClient, calls } = fakeClient(VESSEL);
    const vessel = createVesselStore(vesselClient);
    const device = createDeviceStore(memoryStorage(), { app: 'harbor', registry: FLEET_SETTINGS });

    const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [vessel, device] });
    await vessel.load();

    await settings.set('nmea.gateway.host', '127.0.0.1', { scope: 'device' });

    expect(settings.resolve('nmea.gateway.host')).toEqual({ value: '127.0.0.1', source: 'device' });
    // The boat's row was read and never written.
    expect(calls.filter((call) => call.kind !== 'select')).toEqual([]);
  });

  it('shows the declared default before the cloud layers have loaded', async () => {
    const { client } = fakeClient(ACCOUNT);
    const account = createAccountStore(client, 'user-1');
    const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [account] });

    // First render: nothing has loaded, and the app still has an answer.
    expect(settings.resolve('units.metric')).toEqual({ value: false, source: 'default' });

    await account.load();
    expect(settings.source('units.metric')).toBe('account');
  });
});
