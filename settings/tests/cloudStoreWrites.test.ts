import { describe, expect, it, vi } from 'vitest';
import { createVesselStore, NoRowError } from '../src/cloudStore.js';
import type { SupabaseLike } from '../src/cloudStore.js';
import type { StorageLike } from '../src/deviceStore.js';

/**
 * Writes that cross a read, writes that cross each other, and writes that land
 * on nothing.
 *
 * The client here holds a blob and an identity row like the server does, and
 * every request can be held open and released by the test, so the orderings
 * that matter can be made to happen rather than hoped for.
 */
interface Gate {
  promise: Promise<void>;
  open(): void;
}
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

function server(initial: { blob: Record<string, string>; identity: Record<string, string | null> | null }) {
  const blob = { ...initial.blob };
  const identity = initial.identity ? { ...initial.identity } : null;
  const state = {
    blob,
    identity,
    /** Set to hold the next read / write open until the test releases it. */
    holdRead: null as Gate | null,
    holdWrite: [] as Gate[],
    failWrites: [] as boolean[],
    readsFail: false,
    rpcs: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
  };
  async function writeTurn(): Promise<boolean> {
    const held = state.holdWrite.shift();
    const fail = state.failWrites.shift() ?? false;
    if (held) await held.promise;
    return fail;
  }
  const supabase: SupabaseLike = {
    from(table: string) {
      return {
        select: () => ({
          match: () => ({
            maybeSingle: async () => {
              // The answer is what the server held when the request arrived.
              const snapshot =
                table === 'vessel_settings' ? { settings: { ...blob } } : identity ? { ...identity } : null;
              if (table === 'vessel_settings' && state.holdRead) await state.holdRead.promise;
              if (state.readsFail) throw new TypeError('Failed to fetch');
              return { data: snapshot, error: null };
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          match: () => ({
            select: async () => {
              if (await writeTurn()) return { data: null, error: { message: 'Failed to fetch' } };
              state.updates.push(payload);
              if (!identity) return { data: [], error: null };
              for (const [column, value] of Object.entries(payload)) {
                if (column !== 'updated_at') identity[column] = value as string | null;
              }
              return { data: [{}], error: null };
            },
          }),
        }),
      };
    },
    rpc: async (_fn: string, args?: Record<string, unknown>) => {
      state.rpcs.push(args ?? {});
      if (await writeTurn()) return { data: null, error: { message: 'Failed to fetch' } };
      for (const [key, value] of Object.entries((args?.patch as Record<string, string>) ?? {})) blob[key] = value;
      for (const key of (args?.remove_keys as string[]) ?? []) delete blob[key];
      return { data: null, error: null };
    },
  };
  return { supabase, state };
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

const own = async () => ({ id: 'v-uuid-1', vesselSlug: 'saorsa' });
const HOST = 'nmea.gateway.host';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loaded(options: { queue?: (key: string) => boolean; identity?: Record<string, string | null> | null } = {}) {
  const fake = server({
    blob: { [HOST]: '192.168.1.10', 'alarms.depth.min_m': '3' },
    identity: options.identity === undefined ? { name: 'Saorsa', mmsi: '366895720', vessel_type: 'Sloop' } : options.identity,
  });
  const { storage, map } = memoryStorage();
  const store = createVesselStore(fake.supabase, own, storage, { queueWhenOffline: options.queue });
  expect(await store.load()).toBe(true);
  return { store, storage, map, ...fake };
}

describe('a read that crosses a write (L1)', () => {
  it('keeps a value saved while the read was out, though the read answers with the old one', async () => {
    const { store, state } = await loaded();
    state.holdRead = gate();
    const reading = store.load(); // arrives at the server now, and will answer 192.168.1.10
    await settle();
    await store.set(HOST, '192.168.1.99');
    state.holdRead.open();
    await reading;
    expect(store.get(HOST)).toBe('192.168.1.99');
    // The next read, which postdates the write, is taken as it comes.
    state.holdRead = null;
    state.blob[HOST] = '10.0.0.5'; // another device changed it since
    await store.load();
    expect(store.get(HOST)).toBe('10.0.0.5');
  });

  it('keeps a value whose write is still in the air when the read comes back', async () => {
    const { store, state } = await loaded();
    const held = gate();
    state.holdWrite.push(held);
    const writing = store.set(HOST, '192.168.1.99');
    await settle();
    await store.load(); // the server has not applied the write yet
    expect(store.get(HOST)).toBe('192.168.1.99');
    held.open();
    await writing;
    expect(store.get(HOST)).toBe('192.168.1.99');
  });

  it('goes back to what the server last said when that write then fails', async () => {
    const { store, state } = await loaded();
    const held = gate();
    state.holdWrite.push(held);
    state.failWrites.push(true);
    const writing = store.set(HOST, '192.168.1.99');
    await settle();
    state.blob[HOST] = '10.0.0.5'; // changed elsewhere, and read while our write is out
    await store.load();
    held.open();
    await expect(writing).rejects.toThrow();
    expect(store.get(HOST)).toBe('10.0.0.5');
  });

  it('leaves keys nobody wrote to the server\'s answer', async () => {
    const { store, state } = await loaded();
    state.holdRead = gate();
    const reading = store.load();
    await settle();
    await store.set(HOST, '192.168.1.99');
    state.holdRead.open();
    await reading;
    expect(store.get('alarms.depth.min_m')).toBe('3');
    expect(store.get('vessel.name')).toBe('Saorsa');
  });

  it('tells subscribers when a load fails, since `loaded` has changed', async () => {
    const fake = server({ blob: {}, identity: null });
    fake.state.readsFail = true;
    const store = createVesselStore(fake.supabase, own, memoryStorage().storage);
    const heard = vi.fn();
    store.subscribe(heard);
    expect(await store.load()).toBe(false);
    expect(store.loaded).toBe(true);
    expect(heard).toHaveBeenCalled();
  });
});

describe('two writes to one key (L1)', () => {
  it('sends them one at a time, in the order they were made', async () => {
    const { store, state } = await loaded();
    const first = gate();
    state.holdWrite.push(first);
    const a = store.set(HOST, 'first');
    const b = store.set(HOST, 'second');
    await settle();
    expect(state.rpcs).toHaveLength(1); // the second waits its turn
    first.open();
    await Promise.all([a, b]);
    expect(state.rpcs.map((args) => (args.patch as Record<string, string>)[HOST])).toEqual(['first', 'second']);
    expect(state.blob[HOST]).toBe('second');
    expect(store.get(HOST)).toBe('second');
  });

  it('does not roll back to the old value when the first fails and the second lands', async () => {
    const { store, state } = await loaded();
    state.failWrites.push(true, false);
    const a = store.set(HOST, 'first');
    const b = store.set(HOST, 'second');
    await expect(a).rejects.toThrow();
    await b;
    expect(store.get(HOST)).toBe('second');
    expect(state.blob[HOST]).toBe('second');
  });

  it('rolls back to the first when it landed and the second fails', async () => {
    const { store, state } = await loaded();
    state.failWrites.push(false, true);
    const a = store.set(HOST, 'first');
    const b = store.set(HOST, 'second');
    await a;
    await expect(b).rejects.toThrow();
    expect(store.get(HOST)).toBe('first');
  });

  it('rolls back to the value before either when both fail', async () => {
    const { store, state } = await loaded();
    state.failWrites.push(true, true);
    const a = store.set(HOST, 'first');
    const b = store.set(HOST, 'second');
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    expect(store.get(HOST)).toBe('192.168.1.10');
  });

  it('treats a clear the same way', async () => {
    const { store, state } = await loaded();
    state.failWrites.push(true);
    await expect(store.clear(HOST)).rejects.toThrow();
    expect(store.get(HOST)).toBe('192.168.1.10');
    await store.clear(HOST);
    expect(store.get(HOST)).toBeUndefined();
    expect(state.blob[HOST]).toBeUndefined();
  });
});

describe('a column write that matches no row (L2)', () => {
  it('is a failure, and the value goes back', async () => {
    const fake = server({ blob: { [HOST]: 'x' }, identity: null });
    const store = createVesselStore(fake.supabase, own, memoryStorage().storage);
    await store.load();
    await expect(store.set('vessel.name', 'Saorsa')).rejects.toBeInstanceOf(NoRowError);
    expect(store.get('vessel.name')).toBeUndefined();
  });

  it('does not hold up the other writes waiting behind it', async () => {
    const { storage } = memoryStorage();
    const fake = server({ blob: {}, identity: null });
    fake.state.failWrites.push(true, true);
    const store = createVesselStore(fake.supabase, own, storage, { queueWhenOffline: () => true });
    await store.load();
    await store.set('vessel.name', 'Saorsa'); // offline: held
    await store.set('alarms.depth.min_m', '4'); // offline: held
    expect(store.pendingKeys()).toEqual(['vessel.name', 'alarms.depth.min_m']);
    await store.load(); // back online, and there is still no vessels row
    expect(fake.state.blob['alarms.depth.min_m']).toBe('4');
    expect(store.pendingKeys()).toEqual(['vessel.name']);
  });
});

describe('reset({ keepQueued })', () => {
  async function heldOffline() {
    const made = await loaded({ queue: (key) => key.startsWith('alarms.') });
    made.state.failWrites.push(true);
    await made.store.set('alarms.depth.min_m', '5');
    expect(made.store.pendingKeys()).toEqual(['alarms.depth.min_m']);
    return made;
  }

  it('drops the queue by default, as an account change must', async () => {
    const { store, state, map } = await heldOffline();
    store.reset();
    expect(store.pendingKeys()).toEqual([]);
    expect(map.has('sentinel.cloud.vessel.pending')).toBe(false);
    await store.load();
    expect(state.blob['alarms.depth.min_m']).toBe('3');
  });

  it('keeps it when asked, shows nothing until a load has sent it, then delivers', async () => {
    const { store, state, map } = await heldOffline();
    store.reset({ keepQueued: true });
    expect(store.pendingKeys()).toEqual(['alarms.depth.min_m']);
    expect(map.has('sentinel.cloud.vessel.pending')).toBe(true);
    expect(store.get('alarms.depth.min_m')).toBeUndefined(); // the cache is still emptied
    expect(await store.load()).toBe(true);
    expect(state.blob['alarms.depth.min_m']).toBe('5');
    expect(store.get('alarms.depth.min_m')).toBe('5');
    expect(store.pendingKeys()).toEqual([]);
  });
});
