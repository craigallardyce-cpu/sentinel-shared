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
    from(table: string): any;
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
    columnsTable?: {
        table: string;
        match?: Record<string, string>;
    };
    /** The server-side merge function, and any fixed arguments it takes. */
    merge: {
        fn: string;
        args?: Record<string, unknown>;
    };
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
}
export declare function createCloudStore(options: CloudStoreOptions): CloudStore;
/**
 * The account layer: `public.user_settings`, one row per signed-in user.
 *
 * No `columns` map — everything account-scoped lives in the blob, because what
 * is account-scoped changes every release and a column per setting is how
 * `system_config` reached fourteen of them.
 */
export declare function createAccountStore(client: SupabaseLike, userId: string, cacheStorage?: StorageLike): CloudStore;
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
export declare function createVesselStore(client: SupabaseLike, resolve: () => Promise<{
    id: string;
    vesselSlug: string;
} | null>, cacheStorage?: StorageLike): CloudStore;
