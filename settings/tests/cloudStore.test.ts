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
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
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
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
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
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
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
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
    await store.load();

    await expect(store.set('nmea.gateway.host', '10.10.10.1')).rejects.toThrow(/permission denied/);
    expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
  });

  it('clears a blob key through the same merge function', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
    await store.load();

    await store.clear('nmea.datahub_url');

    const rpc = calls.find((call) => call.kind === 'rpc');
    expect(rpc?.args).toEqual({ slug: 'sentinel', remove_keys: ['nmea.datahub_url'] });
    expect(store.get('nmea.datahub_url')).toBeUndefined();
  });

  it('clears an identity key by nulling its column', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
    await store.load();

    await store.clear('vessel.mmsi');

    const update = calls.find((call) => call.kind === 'update');
    expect((update?.payload as Record<string, unknown>).mmsi).toBeNull();
  });
});

describe('the whole chain, against the live rows', () => {
  it('reads configuration and identity from their separate tables', async () => {
    const { client, calls } = fakeClient(VESSEL);
    const store = createVesselStore(client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
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
    const vessel = createVesselStore(vesselClient, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
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
    const vessel = createVesselStore(vesselClient, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }));
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

describe('the offline cache', () => {
  function cacheStorage(seed: Record<string, string> = {}) {
    const map = new Map(Object.entries(seed));
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('answers on the very first render, before load() has resolved', async () => {
    const storage = cacheStorage();
    const first = createVesselStore(fakeClient(VESSEL).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage);
    await first.load();

    // A later boot, same device: the values are there before anything is fetched.
    const second = createVesselStore(fakeClient(VESSEL).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage);
    expect(second.loaded).toBe(false);
    expect(second.get('vessel.name')).toBe('Saorsa');
    expect(second.get('nmea.gateway.host')).toBe('192.168.86.33');
  });

  it('keeps working with no network at all', async () => {
    const storage = cacheStorage();
    const online = createVesselStore(fakeClient(VESSEL).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage);
    await online.load();

    // Offline: the read fails, and the cached values must survive it. Losing every
    // account and vessel setting the moment a boat leaves wifi would be worse than
    // any staleness.
    const offline = createVesselStore(fakeClient({}).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage);
    await expect(offline.load()).resolves.toBe(false);
    expect(offline.get('vessel.name')).toBe('Saorsa');
  });

  it('is replaced wholesale when the server answers, so it is never authoritative', async () => {
    const storage = cacheStorage();
    await createVesselStore(fakeClient(VESSEL).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage).load();

    const renamed = {
      vessel_settings: { settings: { 'nmea.gateway.host': '10.10.10.1' } },
      vessels: { name: 'Saorsaa', mmsi: null, vessel_type: '' },
    };
    const store = createVesselStore(fakeClient(renamed).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage);
    await store.load();

    expect(store.get('vessel.name')).toBe('Saorsaa');
    expect(store.get('nmea.gateway.host')).toBe('10.10.10.1');
    // Gone from the row, so gone from the cache -- not left behind as a ghost.
    expect(store.get('nmea.datahub_url')).toBeUndefined();
  });

  it('keys the cache by row, so another account cannot read this one back', async () => {
    const storage = cacheStorage();
    await createAccountStore(fakeClient(ACCOUNT).client, 'user-1', storage).load();

    const other = createAccountStore(fakeClient({}).client, 'user-2', storage);
    expect(other.get('units.metric')).toBeUndefined();
  });

  it('survives a corrupt cache entry rather than failing to construct', () => {
    const storage = cacheStorage({ 'sentinel.cloud.vessel.sentinel': 'not json' });
    expect(() => createVesselStore(fakeClient(VESSEL).client, async () => ({ id: 'v-uuid-1', vesselSlug: 'sentinel' }), storage)).not.toThrow();
  });
});

/**
 * Addressing a vessel after website migration 053.
 *
 * The row is found by `vessel_id` now, not by `vessel_slug` — the fleet used to
 * address one hard-coded slug, `'sentinel'`, which was every customer's boat at
 * once. The slug has not gone away: 053 deliberately kept
 * `merge_vessel_settings(slug text, …)` at its existing signature, so the merge
 * RPC is still handed one. Both come from the same resolver, so this package and
 * `@sentinel/vessel` cannot form different opinions about which boat is meant.
 */
function recordingClient() {
  const matches: Array<{ kind: string; table?: string; fn?: string; match?: unknown; args?: unknown }> = [];
  const client: SupabaseLike = {
    from(table: string) {
      return {
        select: () => ({
          match: (m: unknown) => ({
            maybeSingle: async () => {
              matches.push({ kind: 'select', table, match: m });
              return { data: null, error: null };
            },
          }),
        }),
        update: () => ({
          match: async (m: unknown) => {
            matches.push({ kind: 'update', table, match: m });
            return { error: null };
          },
        }),
      };
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      matches.push({ kind: 'rpc', fn, args });
      return { data: null, error: null };
    },
  };
  return { client, matches };
}

const OWN = async () => ({ id: 'v-uuid-1', vesselSlug: 'saorsa-ii' });

describe('addressing the vessel by id', () => {
  it('reads both tables by uuid, never by the slug', async () => {
    const { client, matches } = recordingClient();
    await createVesselStore(client, OWN).load();

    expect(matches.find(m => m.table === 'vessel_settings')?.match).toEqual({ vessel_id: 'v-uuid-1' });
    expect(matches.find(m => m.table === 'vessels')?.match).toEqual({ id: 'v-uuid-1' });
    expect(JSON.stringify(matches)).not.toContain('vessel_slug');
  });

  it('still hands the merge function a slug, because 053 kept that signature', async () => {
    const { client, matches } = recordingClient();
    const store = createVesselStore(client, OWN);
    await store.load();
    await store.set('nmea.gateway.port', '10110');

    const rpc = matches.find(m => m.kind === 'rpc');
    expect(rpc?.fn).toBe('merge_vessel_settings');
    expect((rpc?.args as Record<string, unknown>).slug).toBe('saorsa-ii');
  });

  it('writes an identity column to the vessel row by uuid', async () => {
    const { client, matches } = recordingClient();
    const store = createVesselStore(client, OWN);
    await store.load();
    await store.set('vessel.name', 'Saorsa II');

    const update = matches.find(m => m.kind === 'update');
    expect(update?.table).toBe('vessels');
    expect(update?.match).toEqual({ id: 'v-uuid-1' });
  });

  it('resolves once and reuses it, rather than asking on every call', async () => {
    const { client } = recordingClient();
    const resolve = vi.fn(OWN);
    const store = createVesselStore(client, resolve);
    await store.load();
    await store.set('nmea.gateway.port', '10110');
    await store.clear('nmea.gateway.port');

    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('when no vessel resolves', () => {
  it('reads nothing rather than reading some other boat', async () => {
    const { client, matches } = recordingClient();
    const loaded = await createVesselStore(client, async () => null).load();

    expect(loaded).toBe(false);
    expect(matches).toEqual([]);
  });

  it('refuses a write, naming the setting, instead of failing silently', async () => {
    const { client } = recordingClient();
    const store = createVesselStore(client, async () => null);
    await expect(store.set('vessel.name', 'Saorsa II')).rejects.toThrow(/vessel\.name/);
  });

  it('tries again next time — offline now is not offline forever', async () => {
    const { client } = recordingClient();
    let answer: { id: string; vesselSlug: string } | null = null;
    const store = createVesselStore(client, async () => answer);

    expect(await store.load()).toBe(false);
    answer = { id: 'v-uuid-1', vesselSlug: 'saorsa-ii' };
    await store.load();

    expect(await store.load()).toBe(false); // no row in this fake, but it asked
  });

  it('still answers from the cache, which is the whole point of having one', async () => {
    const storage = memoryStorage({ 'sentinel.cloud.vessel': JSON.stringify({ 'vessel.name': 'Saorsa' }) });
    const { client } = recordingClient();

    expect(createVesselStore(client, async () => null, storage).get('vessel.name')).toBe('Saorsa');
  });
});

describe('the cache across the slug-to-uuid move', () => {
  it('carries the entry written under the old slug-shaped key', () => {
    // What a device that upgrades while offline actually has on disk.
    const storage = memoryStorage({
      'sentinel.cloud.vessel.sentinel': JSON.stringify({ 'vessel.name': 'Saorsa' }),
    });
    const { client } = recordingClient();

    expect(createVesselStore(client, OWN, storage).get('vessel.name')).toBe('Saorsa');
  });

  it('prefers the current key when both exist', () => {
    const storage = memoryStorage({
      'sentinel.cloud.vessel': JSON.stringify({ 'vessel.name': 'Newer' }),
      'sentinel.cloud.vessel.sentinel': JSON.stringify({ 'vessel.name': 'Older' }),
    });
    const { client } = recordingClient();

    expect(createVesselStore(client, OWN, storage).get('vessel.name')).toBe('Newer');
  });
});
