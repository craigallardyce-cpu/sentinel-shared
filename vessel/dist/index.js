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
export const DEFAULT_VESSEL_SLUG = 'sentinel';
/** Columns clients may SELECT (kept in sync with migration 002 + 007). */
const READ_COLUMNS = 'vessel_slug, name, vessel_type, make_model, length_ft, homeport, photo_url, description, mmsi, updated_at';
function rowToProfile(row) {
    return {
        vesselSlug: String(row.vessel_slug ?? DEFAULT_VESSEL_SLUG),
        name: String(row.name ?? ''),
        vesselType: row.vessel_type ?? null,
        makeModel: row.make_model ?? null,
        lengthFt: row.length_ft === null || row.length_ft === undefined ? null : Number(row.length_ft),
        homeport: row.homeport ?? null,
        mmsi: row.mmsi ?? null,
        photoUrl: row.photo_url ?? null,
        description: row.description ?? null,
        updatedAt: row.updated_at ?? null,
    };
}
/**
 * Read the shared vessel record. Returns null when the row does not exist or
 * the read fails (offline) — callers keep their local value in that case.
 */
export async function fetchVesselProfile(supabase, vesselSlug = DEFAULT_VESSEL_SLUG) {
    try {
        const { data, error } = await supabase.from('vessels').select(READ_COLUMNS).eq('vessel_slug', vesselSlug).maybeSingle();
        if (error || !data)
            return null;
        return rowToProfile(data);
    }
    catch {
        return null;
    }
}
/**
 * Write identity fields through to the shared record. Best-effort by design:
 * returns false (and stays quiet) when offline or unauthorised, so callers can
 * treat the shared record as eventually consistent rather than a hard
 * dependency. Requires a signed-in client for name/vesselType (migration 007).
 */
export async function saveVesselProfile(supabase, patch, vesselSlug = DEFAULT_VESSEL_SLUG) {
    const values = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined)
        values.name = patch.name;
    if (patch.vesselType !== undefined)
        values.vessel_type = patch.vesselType;
    if (patch.mmsi !== undefined)
        values.mmsi = patch.mmsi;
    if (Object.keys(values).length === 1)
        return true; // nothing to write
    try {
        const { error } = await supabase.from('vessels').update(values).eq('vessel_slug', vesselSlug);
        return !error;
    }
    catch {
        return false;
    }
}
