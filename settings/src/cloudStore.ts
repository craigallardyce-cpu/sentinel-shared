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
  /** How to find the one row — `{ user_id }` or `{ vessel_slug }`. */
  match: Record<string, string>;
  /** The jsonb column the settings blob lives in. */
  jsonColumn: string;
  /**
   * Registry keys whose home is a real column rather than the blob.
   *
   * This exists for vessel identity. `vessels.name`, `mmsi` and `vessel_type`
   * are governed by per-column grants the marketing site depends on, so they
   * cannot move into a blob — but they are still settings, and a reader should
   * not have to know which storage a key happens to use.
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
  columnsTable?: { table: string; match: Record<string, string> };
  /** The server-side merge function, and any fixed arguments it takes. */
  merge: { fn: string; args?: Record<string, unknown> };
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
}

export function createCloudStore(options: CloudStoreOptions): CloudStore {
  const { scope, client, table, match, jsonColumn, columns = {}, columnsTable, merge } = options;
  const identity = columnsTable ?? { table, match };
  const hasColumns = Object.keys(columns).length > 0;

  const cache = new Map<string, string>();
  const listeners = new Set<() => void>();
  let loaded = false;

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

  const store: CloudStore = {
    scope,

    get loaded() {
      return loaded;
    },

    async load() {
      try {
        const next = new Map<string, string>();
        let found = false;

        const blobRow = await client.from(table).select(jsonColumn).match(match).maybeSingle();
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
            .match(identity.match)
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

        cache.clear();
        for (const [key, value] of next) cache.set(key, value);

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
      try {
        const column = columns[key];
        if (column) {
          const { error } = await client
            .from(identity.table)
            .update({ [column]: raw, updated_at: new Date().toISOString() })
            .match(identity.match);
          if (error) throw new Error(error.message ?? String(error));
        } else {
          const { error } = await client.rpc(merge.fn, { ...merge.args, patch: { [key]: raw } });
          if (error) throw new Error(error.message ?? String(error));
        }
        notify();
      } catch (cause) {
        // Roll back, or the screen would show a value nothing is holding.
        if (previous === undefined) cache.delete(key);
        else cache.set(key, previous);
        notify();
        throw cause;
      }
    },

    async clear(key) {
      const previous = cache.get(key);
      cache.delete(key);
      try {
        const column = columns[key];
        if (column) {
          const { error } = await client
            .from(identity.table)
            .update({ [column]: null, updated_at: new Date().toISOString() })
            .match(identity.match);
          if (error) throw new Error(error.message ?? String(error));
        } else {
          const { error } = await client.rpc(merge.fn, { ...merge.args, remove_keys: [key] });
          if (error) throw new Error(error.message ?? String(error));
        }
        notify();
      } catch (cause) {
        if (previous !== undefined) cache.set(key, previous);
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
export function createAccountStore(client: SupabaseLike, userId: string): CloudStore {
  return createCloudStore({
    scope: 'account',
    client,
    table: 'user_settings',
    match: { user_id: userId },
    jsonColumn: 'settings',
    merge: { fn: 'merge_user_settings' },
  });
}

export const DEFAULT_VESSEL_SLUG = 'sentinel';

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
export function createVesselStore(client: SupabaseLike, vesselSlug: string = DEFAULT_VESSEL_SLUG): CloudStore {
  return createCloudStore({
    scope: 'vessel',
    client,
    // Configuration lives apart from the public identity row, because that row is
    // readable by anyone with the shared voyage link.
    table: 'vessel_settings',
    match: { vessel_slug: vesselSlug },
    jsonColumn: 'settings',
    columns: {
      'vessel.name': 'name',
      'vessel.mmsi': 'mmsi',
      'vessel.type': 'vessel_type',
    },
    columnsTable: { table: 'vessels', match: { vessel_slug: vesselSlug } },
    merge: { fn: 'merge_vessel_settings', args: { slug: vesselSlug } },
  });
}
