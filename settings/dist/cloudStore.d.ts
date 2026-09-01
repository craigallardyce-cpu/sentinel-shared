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
    from(table: string): any;
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
    columnsTable?: {
        table: string;
        match: Record<string, string>;
    };
    /** The server-side merge function, and any fixed arguments it takes. */
    merge: {
        fn: string;
        args?: Record<string, unknown>;
    };
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
export declare function createAccountStore(client: SupabaseLike, userId: string): CloudStore;
export declare const DEFAULT_VESSEL_SLUG = "sentinel";
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
export declare function createVesselStore(client: SupabaseLike, vesselSlug?: string): CloudStore;
