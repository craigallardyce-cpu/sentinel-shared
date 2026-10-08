import { describe, expect, it } from 'vitest';
import { createVesselStore } from '../src/cloudStore.js';
import { createDeviceStore } from '../src/deviceStore.js';
import { FLEET_SETTINGS } from '../src/fleet.js';
import { createSettingsStore } from '../src/store.js';
import type { SupabaseLike } from '../src/cloudStore.js';
import type { StorageLike } from '../src/deviceStore.js';

/**
 * `queueWhenOffline`: alarm limits belong to the boat, and are set offshore.
 *
 * The client's network can be switched off and on, so "offline" and "back in
 * signal" are the same store across both. Its rpc applies the merge to the
 * fake row the way merge_vessel_settings does.
 */
function switchableClient(rows: Record<string, Record<string, unknown> | null>) {
  const state = { online: false, rpcs: [] as Array<Record<string, unknown>> };
  const client: SupabaseLike = {
    from(table: string) {
      return {
        select: () => ({
          match: () => ({
            maybeSingle: async () => {
              if (!state.online) throw new TypeError('Failed to fetch');
              return { data: rows[table] ?? null, error: null };
            },
          }),
        }),
        update: () => ({
          match: async () => (state.online ? { error: null } : { error: { message: 'Failed to fetch' } }),
        }),
      };
    },
    rpc: async (_fn: string, args?: Record<string, unknown>) => {
      if (!state.online) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
      state.rpcs.push(args ?? {});
      const row = (rows.vessel_settings ??= { settings: {} });
      const blob = row.settings as Record<string, unknown>;
      Object.assign(blob, (args?.patch as Record<string, unknown>) ?? {});
      for (const key of (args?.remove_keys as string[]) ?? []) delete blob[key];
      return { data: null, error: null };
    },
  };
  return { client, state };
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const alarms = (key: string) => key.startsWith('alarms.');
const own = async () => ({ id: 'v-uuid-1', vesselSlug: 'saorsa-ii' });

describe('writes held for the server (queueWhenOffline)', () => {
  it('keeps an offline write, applies it at once, and does not reject', async () => {
    const { client } = switchableClient({ vessel_settings: { settings: {} } });
    const store = createVesselStore(client, own, memoryStorage(), { queueWhenOffline: alarms });

    await expect(store.set('alarms.depth_limit_ft', '12')).resolves.toBeUndefined();
    expect(store.get('alarms.depth_limit_ft')).toBe('12');
    expect(store.pendingKeys()).toEqual(['alarms.depth_limit_ft']);
  });

  it('still rolls back and rejects for a key it does not queue', async () => {
    const { client } = switchableClient({ vessel_settings: { settings: {} } });
    const store = createVesselStore(client, own, memoryStorage(), { queueWhenOffline: alarms });

    await expect(store.set('nmea.gateway.port', '10110')).rejects.toThrow();
    expect(store.get('nmea.gateway.port')).toBeUndefined();
    expect(store.pendingKeys()).toEqual([]);
  });

  it('queues nothing when no predicate is given: the default rule is unchanged', async () => {
    const { client } = switchableClient({ vessel_settings: { settings: {} } });
    const store = createVesselStore(client, own, memoryStorage());
    await expect(store.set('alarms.depth_limit_ft', '12')).rejects.toThrow();
    expect(store.get('alarms.depth_limit_ft')).toBeUndefined();
  });

  it('queues even when no vessel could be resolved yet', async () => {
    const { client } = switchableClient({});
    const store = createVesselStore(client, async () => null, memoryStorage(), { queueWhenOffline: alarms });
    await store.set('alarms.wind_limit_kt', '25');
    expect(store.get('alarms.wind_limit_kt')).toBe('25');
    expect(store.pendingKeys()).toEqual(['alarms.wind_limit_kt']);
  });

  it('sends what is pending on the next load, in order, and the server then holds it', async () => {
    const rows: Record<string, Record<string, unknown> | null> = {
      vessel_settings: { settings: { 'alarms.wind_limit_kt': '30', 'alarms.sog_max_kt': '9' } },
    };
    const { client, state } = switchableClient(rows);
    const store = createVesselStore(client, own, memoryStorage(), { queueWhenOffline: alarms });
    await store.set('alarms.wind_limit_kt', '20');
    await store.clear('alarms.sog_max_kt');

    state.online = true;
    expect(await store.load()).toBe(true);
    expect(state.rpcs).toEqual([
      { slug: 'saorsa-ii', patch: { 'alarms.wind_limit_kt': '20' } },
      { slug: 'saorsa-ii', remove_keys: ['alarms.sog_max_kt'] },
    ]);
    expect(store.pendingKeys()).toEqual([]);
    expect(store.get('alarms.wind_limit_kt')).toBe('20');
    expect(store.get('alarms.sog_max_kt')).toBeUndefined();
    expect(rows.vessel_settings!.settings).toEqual({ 'alarms.wind_limit_kt': '20' });
  });

  it('survives a restart: the value still applies and is still on its way', async () => {
    const storage = memoryStorage();
    const { client, state } = switchableClient({ vessel_settings: { settings: {} } });
    await createVesselStore(client, own, storage, { queueWhenOffline: alarms }).set('alarms.depth_limit_ft', '9');

    const next = createVesselStore(client, own, storage, { queueWhenOffline: alarms });
    expect(next.get('alarms.depth_limit_ft')).toBe('9');
    expect(next.pendingKeys()).toEqual(['alarms.depth_limit_ft']);
    state.online = true;
    await next.load();
    expect(state.rpcs).toEqual([{ slug: 'saorsa-ii', patch: { 'alarms.depth_limit_ft': '9' } }]);
    expect(next.pendingKeys()).toEqual([]);
  });

  it('a pending clear survives a restart too, and the old value does not come back', async () => {
    const storage = memoryStorage();
    const rows: Record<string, Record<string, unknown> | null> = {
      vessel_settings: { settings: { 'alarms.depth_limit_ft': '30' } },
    };
    const { client, state } = switchableClient(rows);
    state.online = true;
    const first = createVesselStore(client, own, storage, { queueWhenOffline: alarms });
    await first.load();
    state.online = false;
    await first.clear('alarms.depth_limit_ft');

    const next = createVesselStore(client, own, storage, { queueWhenOffline: alarms });
    expect(next.get('alarms.depth_limit_ft')).toBeUndefined();
    state.online = true;
    await next.load();
    expect(next.get('alarms.depth_limit_ft')).toBeUndefined();
    expect(rows.vessel_settings!.settings).toEqual({});
  });

  it('a load that reads the row while a write is still unsent keeps this device on its own value', async () => {
    const rows: Record<string, Record<string, unknown> | null> = {
      vessel_settings: { settings: { 'alarms.depth_limit_ft': '30' } },
    };
    const { client, state } = switchableClient(rows);
    const store = createVesselStore(client, own, memoryStorage(), { queueWhenOffline: alarms });
    await store.set('alarms.depth_limit_ft', '8');

    // The read works but the write is refused.
    state.online = true;
    const rpc = client.rpc;
    client.rpc = async () => ({ data: null, error: { message: 'permission denied' } });
    await store.load();
    expect(store.get('alarms.depth_limit_ft')).toBe('8');
    expect(store.pendingKeys()).toEqual(['alarms.depth_limit_ft']);

    client.rpc = rpc;
    await store.load();
    expect(store.pendingKeys()).toEqual([]);
    expect(store.get('alarms.depth_limit_ft')).toBe('8');
  });

  it('a successful write supersedes a pending one for the same key', async () => {
    const { client, state } = switchableClient({ vessel_settings: { settings: {} } });
    const store = createVesselStore(client, own, memoryStorage(), { queueWhenOffline: alarms });
    await store.set('alarms.depth_limit_ft', '8');
    state.online = true;
    await store.set('alarms.depth_limit_ft', '11');
    expect(store.pendingKeys()).toEqual([]);
    await store.load();
    expect(state.rpcs).toEqual([{ slug: 'saorsa-ii', patch: { 'alarms.depth_limit_ft': '11' } }]);
  });

  it('never delivers a write queued for one boat to another', async () => {
    const storage = memoryStorage();
    const { client, state } = switchableClient({ vessel_settings: { settings: {} } });
    const first = createVesselStore(client, own, storage, { queueWhenOffline: alarms });
    await first.load(); // offline: resolves the boat, reads nothing
    await first.set('alarms.depth_limit_ft', '8');

    state.online = true;
    const other = createVesselStore(client, async () => ({ id: 'v-uuid-2', vesselSlug: 'other' }), storage, {
      queueWhenOffline: alarms,
    });
    await other.load();
    expect(state.rpcs).toEqual([]);
    expect(other.pendingKeys()).toEqual([]);
  });

  it('through the settings chain: a vessel limit applies offline at once, and clears', async () => {
    const { client } = switchableClient({ vessel_settings: { settings: {} } });
    const vessel = createVesselStore(client, own, memoryStorage(), { queueWhenOffline: alarms });
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [vessel, createDeviceStore(memoryStorage(), { app: 'ocean', registry: FLEET_SETTINGS })],
    });
    await settings.set('alarms.depth_limit_ft', 12, { scope: 'vessel' });
    expect(settings.resolve('alarms.depth_limit_ft')).toEqual({ value: 12, source: 'vessel' });
    await settings.clear('alarms.depth_limit_ft', 'vessel');
    expect(settings.resolve('alarms.depth_limit_ft')).toEqual({ value: undefined, source: 'unset' });
  });
});
