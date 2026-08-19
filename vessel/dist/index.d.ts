/**
 * The fleet's canonical vessel identity record.
 *
 * It lives in `public.vessels` in the shared Supabase project — one row per
 * vessel, keyed by `vessel_slug` (historically 'sentinel'). OceanSentinel's
 * shared-logbook view and MMSI sync already read and write it; VesselKeeper's
 * profile editor writes `name` and `vessel_type` through it. Column grants
 * (migrations 002 and 007 in the MarinerSentinel Website repo) decide who may
 * touch what: anon can read the identity columns and update only
 * mmsi/updated_at; authenticated can also update name and vessel_type; the
 * site secrets are not client-readable at all.
 *
 * The helpers take any Supabase client (`from(...)` shaped) so this package has
 * zero runtime dependencies and never bundles its own client copy.
 */
export interface VesselProfile {
    vesselSlug: string;
    name: string;
    /** e.g. Sloop, Ketch, Trawler. Free text. */
    vesselType?: string | null;
    makeModel?: string | null;
    lengthFt?: number | null;
    homeport?: string | null;
    mmsi?: string | null;
    photoUrl?: string | null;
    description?: string | null;
    updatedAt?: string | null;
}
/** Identity fields a signed-in client is allowed to update (see migration 007). */
export type VesselProfilePatch = Partial<Pick<VesselProfile, 'name' | 'vesselType' | 'mmsi'>>;
export declare const DEFAULT_VESSEL_SLUG = "sentinel";
export interface SupabaseLike {
    from(table: string): any;
}
/**
 * Read the shared vessel record. Returns null when the row does not exist or
 * the read fails (offline) — callers keep their local value in that case.
 */
export declare function fetchVesselProfile(supabase: SupabaseLike, vesselSlug?: string): Promise<VesselProfile | null>;
/**
 * Write identity fields through to the shared record. Best-effort by design:
 * returns false (and stays quiet) when offline or unauthorised, so callers can
 * treat the shared record as eventually consistent rather than a hard
 * dependency. Requires a signed-in client for name/vesselType (migration 007).
 */
export declare function saveVesselProfile(supabase: SupabaseLike, patch: VesselProfilePatch, vesselSlug?: string): Promise<boolean>;
