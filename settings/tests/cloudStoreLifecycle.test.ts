import { describe, expect, it, vi } from 'vitest';
import { createAccountStore, createVesselStore } from '../src/cloudStore.js';
import type { SupabaseLike } from '../src/cloudStore.js';
import type { StorageLike } from '../src/deviceStore.js';

/**
 * Partial reads, account changes and concurrent addressing.
 *
 * The client's reads can be told, per table, to answer, to return a PostgREST
 * error envelope, or to throw (a dropped connection), so a load can fail on one
 * table and succeed on the other.
 */
type ReadMode = 'ok' | 'error' | 'throw';

function client(rows: Record<string, Record<string, unknown> | null>) {
  const reads: Record<string, ReadMode> = {};
  const state = { writesFail: false, rpcs: [] as Array<Record<string, unknown>>, selects: [] as string[] };
  const supabase: SupabaseLike = {
    from(table: string) {
      return {
        select: () => ({
          match: () => ({
            maybeSingle: async () => {
              state.selects.push(table);
              const mode = reads[table] ?? 'ok';
              if (mode === 'throw') throw new TypeError('Failed to fetch');
              if (mode === 'error') return { data: null, error: { message: 'statement timeout' } };
              return { data: rows[table] ?? null, error: null };
            },
          }),
        }),
        update: () => ({
          match: async () => (state.writesFail ? { error: { message: 'Failed to fetch' } } : { error: null }),
        }),
      };
    },
    rpc: async (_fn: string, args?: Record<string, unknown>) => {
      if (state.writesFail) return { data: null, error: { message: 'Failed to fetch' } };
      state.rpcs.push(args ?? {});
      return { data: null, error: null };
    },
  };
  return { supabase, reads, state };
}

function memoryStorage() {
  const map = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { map, storage };
}

const VESSEL = {
  vessel_settings: {
    settings: {
      'nmea.gateway.host': '192.168.86.33',
      'nmea.gateway.port': '10110',
      'alarms.depth.min_m': '3',
    },
  },
  vessels: { name: 'Saorsa', mmsi: '366895720', vessel_type: '' },
};

const own = async () => ({ id: 'v-uuid-1', vesselSlug: 'saorsa' });
const alarms = (key: string) => key.startsWith('alarms.');

/** A store that has loaded the full row once, so its cache holds both halves. */
async function primed() {
  const { storage, map } = memoryStorage();
  const fake = client(VESSEL);
  const store = createVesselStore(fake.supabase, own, storage, { queueWhenOffline: alarms });
  expect(await store.load()).toBe(true);
  return { store, storage, map, fake };
}

describe('a load where one read fails (S-05)', () => {
  for (const mode of ['error', 'throw'] as const) {
    it(`blob read ${mode === 'error' ? 'errors' : 'throws'}, identity read succeeds: nothing is lost`, async () => {
      const { store, storage, map, fake } = await primed();
      const persisted = map.get('sentinel.cloud.vessel');
      fake.reads.vessel_settings = mode;

      expect(await store.load()).toBe(false);

      expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
      expect(store.get('alarms.depth.min_m')).toBe('3');
      expect(store.get('vessel.name')).toBe('Saorsa');
      expect(map.get('sentinel.cloud.vessel')).toBe(persisted);

      // And after a restart, the persisted copy still holds the blob keys.
      const next = createVesselStore(client({}).supabase, own, storage);
      expect(next.get('nmea.gateway.host')).toBe('192.168.86.33');
    });

    it(`identity read ${mode === 'error' ? 'errors' : 'throws'}, blob read succeeds: nothing is lost`, async () => {
      const { store, map, fake } = await primed();
      const persisted = map.get('sentinel.cloud.vessel');
      fake.reads.vessels = mode;

      expect(await store.load()).toBe(false);

      expect(store.get('vessel.name')).toBe('Saorsa');
      expect(store.get('vessel.mmsi')).toBe('366895720');
      expect(store.get('nmea.gateway.host')).toBe('192.168.86.33');
      expect(map.get('sentinel.cloud.vessel')).toBe(persisted);
    });
  }

  it('still counts an absent row (no data, no error) as an answer', async () => {
    const { storage } = memoryStorage();
    // No vessel_settings row yet: a boat that has never saved a setting.
    const store = createVesselStore(client({ vessels: VESSEL.vessels }).supabase, own, storage);
    expect(await store.load()).toBe(true);
    expect(store.get('vessel.name')).toBe('Saorsa');
    expect(store.get('nmea.gateway.host')).toBeUndefined();
  });

  it('a whole-account load that errors leaves the account cache alone', async () => {
    const { storage } = memoryStorage();
    const fake = client({ user_settings: { settings: { 'units.metric': 'false' } } });
    const store = createAccountStore(fake.supabase, 'user-1', storage);
    await store.load();
    fake.reads.user_settings = 'error';

    expect(await store.load()).toBe(false);
    expect(store.loaded).toBe(true);
    expect(store.get('units.metric')).toBe('false');
  });
});

describe('reset() when the account changes (S-06)', () => {
  it('re-resolves the row: the next load calls address() again', async () => {
    const resolve = vi.fn(own);
    const store = createVesselStore(client(VESSEL).supabase, resolve);
    await store.load();
    await store.load();
    expect(resolve).toHaveBeenCalledTimes(1); // Still memoized between resets.

    store.reset();
    await store.load();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('addresses the new account, not the previous one', async () => {
    let account = { id: 'v-uuid-1', vesselSlug: 'saorsa' };
    const fake = client(VESSEL);
    const store = createVesselStore(fake.supabase, async () => account);
    await store.set('nmea.gateway.port', '10110');

    store.reset();
    account = { id: 'v-uuid-2', vesselSlug: 'other' };
    await store.set('nmea.gateway.port', '2000');

    expect(fake.state.rpcs.map((args) => args.slug)).toEqual(['saorsa', 'other']);
  });

  it('empties the cache, in memory and in storage, legacy names included', async () => {
    const { store, storage, map } = await primed();
    map.set('sentinel.cloud.vessel.sentinel', JSON.stringify({ 'vessel.name': 'Old slug-keyed copy' }));

    store.reset();

    expect(store.get('vessel.name')).toBeUndefined();
    expect(store.get('nmea.gateway.host')).toBeUndefined();
    expect(store.loaded).toBe(false);
    expect(map.has('sentinel.cloud.vessel')).toBe(false);
    expect(map.has('sentinel.cloud.vessel.sentinel')).toBe(false);
    // A restart before the new account loads finds nothing of the old boat.
    expect(createVesselStore(client({}).supabase, async () => null, storage).get('vessel.name')).toBeUndefined();
  });

  it('drops queued writes, in memory and in storage', async () => {
    const { store, storage, map, fake } = await primed();
    fake.state.writesFail = true;
    await store.set('alarms.depth.min_m', '5');
    expect(store.pendingKeys()).toEqual(['alarms.depth.min_m']);
    expect(map.has('sentinel.cloud.vessel.pending')).toBe(true);

    store.reset();

    expect(store.pendingKeys()).toEqual([]);
    expect(map.has('sentinel.cloud.vessel.pending')).toBe(false);
    fake.state.writesFail = false;
    await store.load();
    expect(fake.state.rpcs).toEqual([]); // Nothing from the previous account was sent.

    const restarted = createVesselStore(client({}).supabase, own, storage, { queueWhenOffline: alarms });
    expect(restarted.pendingKeys()).toEqual([]);
  });

  it('notifies subscribers so values re-resolve', async () => {
    const { store } = await primed();
    const listener = vi.fn();
    store.subscribe!(listener);
    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('discards a load for the previous account that lands after the reset', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store = createVesselStore(client(VESSEL).supabase, async () => {
      await gate;
      return { id: 'v-uuid-1', vesselSlug: 'saorsa' };
    });

    const stale = store.load();
    store.reset();
    release();

    expect(await stale).toBe(false);
    expect(store.get('vessel.name')).toBeUndefined();
    expect(store.loaded).toBe(false);
  });
});

describe('concurrent addressing (S-18)', () => {
  it('two concurrent sets resolve the row once', async () => {
    const resolve = vi.fn(own);
    const store = createVesselStore(client(VESSEL).supabase, resolve);

    await Promise.all([store.set('nmea.gateway.port', '10110'), store.set('nmea.gateway.host', '10.0.0.1')]);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('a load and a set fired together resolve the row once', async () => {
    const resolve = vi.fn(own);
    const store = createVesselStore(client(VESSEL).supabase, resolve);

    await Promise.all([store.load(), store.set('nmea.gateway.port', '10110')]);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('a null answer shared by concurrent calls is still not memoized', async () => {
    let answer: { id: string; vesselSlug: string } | null = null;
    const resolve = vi.fn(async () => answer);
    const store = createVesselStore(client(VESSEL).supabase, resolve);

    expect(await Promise.all([store.load(), store.load()])).toEqual([false, false]);
    expect(resolve).toHaveBeenCalledTimes(1);

    answer = { id: 'v-uuid-1', vesselSlug: 'saorsa' };
    expect(await store.load()).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('a resolver that throws is shared, not memoized, and tried again', async () => {
    let fail = true;
    const resolve = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return { id: 'v-uuid-1', vesselSlug: 'saorsa' };
    });
    const store = createVesselStore(client(VESSEL).supabase, resolve);

    await Promise.all([store.load(), store.load()]);
    expect(resolve).toHaveBeenCalledTimes(1);

    fail = false;
    expect(await store.load()).toBe(true);
  });
});
