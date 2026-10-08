/**
 * The account and vessel layers, backed by Supabase.
 *
 * Two things shape this file and neither is negotiable.
 *
 * **Reads are synchronous; loading is not.** `ScopeStore.get` must answer
 * immediately, because every settings read in OceanSentinel is a
 * `useState(() => ...)` initialiser that runs during the first render. A cloud
 * layer cannot answer then, so it answers `undefined` — which resolution reads
 * as "this layer has nothing" and falls through — and `load()` fills a cache
 * afterwards and notifies. The first paint shows the declared default or the
 * device value; the account and vessel values promote in behind it.
 *
 * **Writes merge in the database, not in the client.** Sending back a blob the
 * client read a moment ago is read-modify-write, and it loses whichever setting
 * another device saved in between — the same whole-document clobber the fleet
 * already hit when HarborSentinel's `POST /config` built one UPDATE from a whole
 * request body. `merge_user_settings` and `merge_vessel_settings` concatenate
 * server-side in a single statement, so a partial write stays partial.
 *
 * The client is injected, exactly as in `@sentinel/vessel`, so this package
 * depends on no Supabase library and three apps install nothing new.
 */

import type { StorageLike } from './deviceStore.js';
import type { Scope, ScopeStore } from './types.js';

/**
 * Any `@supabase/supabase-js` client, structurally. Deliberately loose: a
 * precise type would drag the library's deep generics into every consumer, which
 * is what trips TS2589 in apps that install this.
 */
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

export interface CloudStoreOptions {
  scope: Scope;
  client: SupabaseLike;
  /** Table holding the row for this layer. */
  table: string;
  /**
   * How to find the one row — `{ user_id }`, say.
   *
   * Omitted only when `address` supplies it at runtime, which is what the vessel
   * layer does now that a vessel is addressed by a uuid nobody knows until the
   * server says so.
   */
  match?: Record<string, string>;
  /** The jsonb column the settings blob lives in. */
  jsonColumn: string;
  /**
   * Registry keys whose home is a real column rather than the blob.
   *
   * This exists for vessel identity. `vessels.name`, `mmsi`, `vessel_type` and
   * the hull geometry are governed by per-column grants the marketing site
   * depends on, so they cannot move into a blob — but they are still settings,
   * and a reader should not have to know which storage a key happens to use.
   */
  columns?: Record<string, string>;
  /**
   * Where the mapped columns live, when that is a different table from the blob.
   *
   * The vessel layer needs this. `public.vessels` is publicly readable — it backs
   * the shared voyage pages — so a boat's configuration cannot sit on that row,
   * while its identity is exactly what belongs there. The blob lives in
   * `public.vessel_settings`, owner-only, and the two are read together.
   */
  columnsTable?: { table: string; match?: Record<string, string> };
  /** The server-side merge function, and any fixed arguments it takes. */
  merge: { fn: string; args?: Record<string, unknown> };
  /**
   * Work out which row this store addresses, when that can only be known at
   * runtime. Resolved once, on first use, and reused thereafter.
   *
   * The vessel layer needs it: since website migration 053 a vessel is addressed
   * by its uuid, and which uuid belongs to the signed-in account is a question
   * only the server can answer. Returning null means "not resolvable yet" -- no
   * row is read or written, and the next call tries again, which is the right
   * behaviour for a device that is simply offline.
   *
   * Deliberately consulted inside `load`, `set` and `clear` rather than before
   * construction. Constructing lazily would be simpler and would break the case
   * this store exists for: `readCache()` runs synchronously so the layer can
   * answer on the first render and keep answering with no network. A store that
   * waited for a round trip before it existed would give a boat with no internet
   * an empty settings screen for the whole session.
   */
  address?: () => Promise<Addressing | null>;
  /**
   * Where to keep the last successful load, so this layer can answer before
   * `load()` resolves and while there is no network.
   *
   * Not an optimisation. Without it a cloud layer is empty on every first render
   * -- the boat name would appear, blank, and then fill in -- and empty for the
   * whole session on a boat with no internet, which is most of them. The cached
   * copy is never authoritative: `load()` replaces it wholesale whenever the
   * server answers.
   */
  cache?: {
    storage: StorageLike;
    prefix?: string;
    /**
     * Keys this layer used to cache under, newest first, read once if the
     * current key holds nothing.
     *
     * Needed because the vessel layer's key used to contain the value it
     * addressed by. Moving from `vessel_slug` to `vessel_id` changes the key, and
     * without carrying the old one across, a device that upgrades while offline
     * loses every cached vessel setting and shows declared defaults until it next
     * reaches the server -- on a boat, possibly the whole season. The cache is
     * never authoritative, but "not authoritative" is not the same as "safe to
     * drop on the floor".
     */
    legacyKeys?: readonly string[];
  };
  /**
   * Keys whose writes are kept when the server cannot take them, and sent later.
   *
   * Every other key keeps the default rule -- a write the server refused is
   * rolled back and the promise rejects, so a settings screen can say it did not
   * save. That rule is wrong for an alarm limit. Alarm limits belong to the boat,
   * so they are written to the vessel layer, and a navigator setting one offshore
   * usually has no connection to write it with. Rolling it back would leave the
   * alarm on its old limit, or off, after somebody pressed Set; an alarm has to
   * take its new limit at once and never wait for the network.
   *
   * So for a key this answers true for, a failed `set` or `clear` keeps the new
   * value in the cache (where `get` reads it, and the offline cache persists it),
   * records the write as pending, resolves rather than rejects, and is sent again
   * at the start of the next `load()` that can address the row. A pending write
   * survives a restart. While it is pending, a `load()` that reads the row lays
   * it back over what the server said, so the value this device set keeps
   * applying here until it has reached the server.
   *
   * Conflict rule, stated because it is a choice: when the pending write is
   * finally sent, it wins over whatever another device saved in the meantime.
   * It is the later of the two decisions this device knows about, and the
   * alternative -- silently discarding a limit a navigator set -- is worse.
   *
   * Every failure is treated alike, offline or refused: the client cannot tell a
   * dropped connection from much else, and holding the limit somebody set is the
   * safe direction for an alarm. A write the server keeps refusing simply stays
   * pending, and keeps applying on this device.
   */
  queueWhenOffline?: (key: string) => boolean;
}

/** Where a lazily-addressed store's row lives, once something has resolved it. */
export interface Addressing {
  /** Finds the blob row, e.g. `{ vessel_id: '…' }`. */
  match: Record<string, string>;
  /** Finds the mapped-columns row, when `columnsTable` is in play. */
  identityMatch?: Record<string, string>;
  /** Extra arguments the merge function needs, e.g. the slug it still takes. */
  mergeArgs?: Record<string, unknown>;
}

export interface CloudStore extends ScopeStore {
  /**
   * Fetch the row into the cache. Resolves `true` when a row was read.
   *
   * Never rejects: offline is the normal state on a boat, and a settings screen
   * that throws on open is worse than one showing the layers it could reach.
   */
  load(): Promise<boolean>;
  /** False until `load()` has completed once. */
  readonly loaded: boolean;
  /**
   * Keys whose last write has not reached the server yet (see
   * `queueWhenOffline`). Always empty for a store that queues nothing.
   */
  pendingKeys(): string[];
}

export function createCloudStore(options: CloudStoreOptions): CloudStore {
  const { scope, client, table, match = {}, jsonColumn, columns = {}, columnsTable, merge } = options;
  const identity = columnsTable ?? { table, match };
  const hasColumns = Object.keys(columns).length > 0;

  const cache = new Map<string, string>();
  const listeners = new Set<() => void>();
  let loaded = false;

  /*
    One entry per layer per row. The row identity is in the key so that signing
    in as somebody else, or switching boats, cannot read back the previous
    account's settings from a stale cache.
  */
  /*
    Keyed on what is known at construction.

    A lazily-addressed store has no identity yet -- that is the point -- so its
    key is the scope alone. That also stops the key moving again the next time
    the addressing does: one built from the identity changes whenever the
    identity does, and each such change silently empties the cache on the one
    layer that has to answer with no network.

    It does NOT rescue the entry written under the old key. Carrying that across
    is what `cache.legacyKeys` is for, and the vessel store passes the old name.
  */
  const cacheKey = `${options.cache?.prefix ?? 'sentinel.cloud.'}${scope}${
    options.address ? '' : `.${Object.values(match).join('.')}`
  }`;

  function readCache(): void {
    if (!options.cache) return;
    try {
      let raw = options.cache.storage.getItem(cacheKey);
      for (const legacy of options.cache.legacyKeys ?? []) {
        if (raw !== null) break;
        raw = options.cache.storage.getItem(legacy);
      }
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') cache.set(key, value);
      }
    } catch {
      /* Unreadable or corrupt: start empty rather than fail to construct. */
    }
  }

  function writeCache(): void {
    if (!options.cache) return;
    try {
      options.cache.storage.setItem(cacheKey, JSON.stringify(Object.fromEntries(cache)));
    } catch {
      /* Out of quota or storage disabled; the layer still works for this session. */
    }
  }

  readCache();

  /*
    Writes held for the server, by key: the raw value, or null for a clear, and
    which row they were meant for when that was known. Persisted beside the
    cache, so a limit set offline is still on its way after a restart.

    The row is remembered so a write queued for one boat is never sent to
    another: if this store is later addressed at a different row, the entry is
    dropped rather than delivered.
  */
  interface Pending {
    raw: string | null;
    target?: string;
  }
  const pending = new Map<string, Pending>();
  const pendingKey = `${cacheKey}.pending`;
  const queues = (key: string) => options.queueWhenOffline?.(key) === true;

  function readPending(): void {
    if (!options.queueWhenOffline || !options.cache) return;
    try {
      const raw = options.cache.storage.getItem(pendingKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue;
        const { raw: value, target } = entry as { raw?: unknown; target?: unknown };
        if (value !== null && typeof value !== 'string') continue;
        pending.set(key, { raw: value, target: typeof target === 'string' ? target : undefined });
      }
    } catch {
      /* Corrupt: nothing pending. The cache still holds the values themselves. */
    }
  }

  function writePending(): void {
    if (!options.queueWhenOffline || !options.cache) return;
    try {
      if (pending.size === 0) options.cache.storage.removeItem(pendingKey);
      else options.cache.storage.setItem(pendingKey, JSON.stringify(Object.fromEntries(pending)));
    } catch {
      /* Out of quota or storage disabled; still pending for this session. */
    }
  }

  /** Lay the pending writes over the cache, so this device keeps applying them. */
  function applyPending(): void {
    for (const [key, entry] of pending) {
      if (entry.raw === null) cache.delete(key);
      else cache.set(key, entry.raw);
    }
  }

  readPending();
  applyPending();

  /*
    Resolved once, then reused. A null answer is not cached: it means the client
    could not reach the server or is not signed in yet, and the next call should
    try again rather than leave the layer dead for the session.
  */
  let addressed: Addressing | null = null;
  async function addressing(): Promise<Addressing | null> {
    if (!options.address) {
      return { match, identityMatch: identity.match, mergeArgs: merge.args };
    }
    if (addressed) return addressed;
    try {
      addressed = await options.address();
    } catch {
      addressed = null;
    }
    return addressed;
  }

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const identityColumns = [...new Set(Object.values(columns))].join(', ');

  /** A stored value of any JSON type, as the string a ScopeStore hands back. */
  function asRaw(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.length > 0 ? value : undefined;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
  }

  /** One key to the server: a value, or null to clear it. Throws on any failure. */
  async function send(at: Addressing, key: string, raw: string | null): Promise<void> {
    const column = columns[key];
    if (column) {
      const { error } = await client
        .from(identity.table)
        .update({ [column]: raw, updated_at: new Date().toISOString() })
        .match(at.identityMatch ?? identity.match);
      if (error) throw new Error(error.message ?? String(error));
    } else {
      const change = raw === null ? { remove_keys: [key] } : { patch: { [key]: raw } };
      const { error } = await client.rpc(merge.fn, { ...(at.mergeArgs ?? merge.args), ...change });
      if (error) throw new Error(error.message ?? String(error));
    }
  }

  const targetOf = (at: Addressing | null) => (at ? JSON.stringify(at.match) : undefined);

  /**
   * Send what is pending, in the order it was queued. Stops at the first
   * failure: offline, the rest would fail too, and they are all still held.
   */
  async function flushPending(at: Addressing): Promise<void> {
    const here = targetOf(at);
    for (const [key, entry] of [...pending]) {
      if (entry.target !== undefined && entry.target !== here) {
        pending.delete(key); // Meant for another row; never deliver it here.
        continue;
      }
      try {
        await send(at, key, entry.raw);
      } catch {
        break;
      }
      // Only if nothing newer was queued for this key while the request was out.
      if (pending.get(key) === entry) pending.delete(key);
    }
    writePending();
  }

  /** A failed write to a queued key: keep it, hold it for the server, carry on. */
  function holdForLater(key: string, raw: string | null, at: Addressing | null): void {
    pending.delete(key); // Re-inserted last, so the queue stays in write order.
    pending.set(key, { raw, target: targetOf(at) });
    writePending();
    writeCache();
    notify();
  }

  const store: CloudStore = {
    scope,

    get loaded() {
      return loaded;
    },

    pendingKeys() {
      return [...pending.keys()];
    },

    async load() {
      try {
        const next = new Map<string, string>();
        let found = false;

        const at = await addressing();
        if (!at) return false;   // Not resolvable yet; the cache still answers.

        // Writes made offline go first, so the read below already reflects them.
        if (pending.size > 0) await flushPending(at);

        const blobRow = await client.from(table).select(jsonColumn).match(at.match).maybeSingle();
        if (!blobRow.error && blobRow.data) {
          found = true;
          const blob = (blobRow.data as Record<string, unknown>)[jsonColumn];
          if (blob && typeof blob === 'object') {
            for (const [key, value] of Object.entries(blob as Record<string, unknown>)) {
              const raw = asRaw(value);
              if (raw !== undefined) next.set(key, raw);
            }
          }
        }

        if (hasColumns) {
          const identityRow = await client
            .from(identity.table)
            .select(identityColumns)
            .match(at.identityMatch ?? identity.match)
            .maybeSingle();
          if (!identityRow.error && identityRow.data) {
            found = true;
            // Columns win over a same-named blob entry: they are what the rest of
            // the fleet already reads, so a blob must never shadow one.
            for (const [key, column] of Object.entries(columns)) {
              const raw = asRaw((identityRow.data as Record<string, unknown>)[column]);
              if (raw !== undefined) next.set(key, raw);
              else next.delete(key);
            }
          }
        }

        /*
          Only replace the cache when the server actually answered. A failed read
          leaves whatever was cached in place, which is what keeps a boat with no
          internet working rather than silently losing every account and vessel
          setting it had.
        */
        if (found) {
          cache.clear();
          for (const [key, value] of next) cache.set(key, value);
          // Anything still unsent is this device's latest word on that key.
          applyPending();
          writeCache();
        }

        loaded = true;
        notify();
        return found;
      } catch {
        /*
          Offline, signed out, or a table this account cannot see. All three mean
          the same thing to a resolution chain — this layer has nothing — and none
          of them should stop the app opening.
        */
        loaded = true;
        return false;
      }
    },

    get(key) {
      return cache.get(key);
    },

    async set(key, raw) {
      const previous = cache.get(key);
      cache.set(key, raw);
      let at: Addressing | null = null;
      try {
        at = await addressing();
        if (!at) throw new Error(`Settings: no ${scope} row is addressable yet, so "${key}" was not saved.`);
        await send(at, key, raw);
        if (pending.delete(key)) writePending();
        writeCache();
        notify();
      } catch (cause) {
        if (queues(key)) {
          holdForLater(key, raw, at);
          return;
        }
        // Roll back, or the screen would show a value nothing is holding.
        if (previous === undefined) cache.delete(key);
        else cache.set(key, previous);
        writeCache();
        notify();
        throw cause;
      }
    },

    async clear(key) {
      const previous = cache.get(key);
      cache.delete(key);
      let at: Addressing | null = null;
      try {
        at = await addressing();
        if (!at) throw new Error(`Settings: no ${scope} row is addressable yet, so "${key}" was not cleared.`);
        await send(at, key, null);
        if (pending.delete(key)) writePending();
        writeCache();
        notify();
      } catch (cause) {
        if (queues(key)) {
          holdForLater(key, null, at);
          return;
        }
        if (previous !== undefined) cache.set(key, previous);
        writeCache();
        notify();
        throw cause;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return store;
}

/**
 * The account layer: `public.user_settings`, one row per signed-in user.
 *
 * No `columns` map — everything account-scoped lives in the blob, because what
 * is account-scoped changes every release and a column per setting is how
 * `system_config` reached fourteen of them.
 */
export function createAccountStore(client: SupabaseLike, userId: string, cacheStorage?: StorageLike): CloudStore {
  return createCloudStore({
    scope: 'account',
    client,
    table: 'user_settings',
    match: { user_id: userId },
    jsonColumn: 'settings',
    merge: { fn: 'merge_user_settings' },
    cache: cacheStorage ? { storage: cacheStorage } : undefined,
  });
}

/**
 * The vessel layer: `public.vessels`, one row per boat.
 *
 * Identity keeps its own columns on `public.vessels`. `@sentinel/vessel` already
 * reads and writes them, the site's per-column grants depend on them, and a
 * boat's name is not something to move into a blob for tidiness. The settings
 * blob lives in `public.vessel_settings` instead, which is owner-only — putting
 * it on `vessels` published the gateway address to every signed-in user of the
 * project, which is not a hypothetical: it was verified before being moved.
 */
export function createVesselStore(
  client: SupabaseLike,
  resolve: () => Promise<{ id: string; vesselSlug: string } | null>,
  cacheStorage?: StorageLike,
  extra: Pick<CloudStoreOptions, 'queueWhenOffline'> = {}
): CloudStore {
  return createCloudStore({
    scope: 'vessel',
    client,
    // Configuration lives apart from the public identity row, because that row is
    // readable by anyone with the shared voyage link.
    table: 'vessel_settings',
    jsonColumn: 'settings',
    columns: {
      'vessel.name': 'name',
      'vessel.mmsi': 'mmsi',
      'vessel.type': 'vessel_type',
    },
    columnsTable: { table: 'vessels' },
    merge: { fn: 'merge_vessel_settings' },
    /*
      Both handles, because the schema still needs both.

      Migration 053 made `id` the vessel's identity and added `vessel_id` to
      `vessel_settings`, so the rows are addressed by uuid. It deliberately kept
      `merge_vessel_settings(slug text, ...)` at its existing signature, so the
      merge RPC is still given a slug. Pass `resolveOwnVessel` from
      `@sentinel/vessel`; this package does not resolve a vessel itself, so the
      two cannot end up with different opinions about which boat is meant.
    */
    address: async () => {
      const own = await resolve();
      if (!own) return null;
      return {
        match: { vessel_id: own.id },
        identityMatch: { id: own.id },
        mergeArgs: { slug: own.vesselSlug },
      };
    },
    cache: cacheStorage
      ? {
          storage: cacheStorage,
          /*
            `vessel_slug` was part of this layer's cache key until the uuid
            replaced it, so the old name is read once -- otherwise a device that
            upgrades with no network loses every cached vessel setting.
          */
          legacyKeys: ['sentinel.cloud.vessel.sentinel'],
        }
      : undefined,
    queueWhenOffline: extra.queueWhenOffline,
  });
}
