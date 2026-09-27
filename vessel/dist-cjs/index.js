"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VESSEL_TYPES = exports.BEAM_M_RANGE = exports.LOA_M_RANGE = exports.HULL_FORMS = void 0;
exports.fetchVesselProfile = fetchVesselProfile;
exports.resolveOwnVessel = resolveOwnVessel;
exports.validateVesselProfilePatch = validateVesselProfilePatch;
exports.saveVesselProfile = saveVesselProfile;
exports.propulsionFor = propulsionFor;
exports.vesselPrefix = vesselPrefix;
/** The three the database accepts, in the order a form should offer them. */
exports.HULL_FORMS = [
    { value: 'monohull', label: 'Monohull' },
    { value: 'catamaran', label: 'Catamaran' },
    { value: 'trimaran', label: 'Trimaran' }
];
/**
 * The ranges the database enforces, exported so a form can label its own field
 * rather than re-typing the numbers and drifting from the CHECK.
 *
 * Both are exclusive at each end, as the CHECKs are: `loa_m > 0 AND loa_m < 200`
 * and `beam_m > 0 AND beam_m < 100`. They are sanity bounds, not a claim about
 * what a cruising boat is -- the point is to catch a beam typed in feet or a
 * length typed in centimetres before the row is written, not to have an opinion
 * about superyachts.
 */
exports.LOA_M_RANGE = { exclusiveMin: 0, exclusiveMax: 200 };
exports.BEAM_M_RANGE = { exclusiveMin: 0, exclusiveMax: 100 };
/** Columns clients may SELECT (kept in sync with migrations 002, 007, 053 and 066). */
const READ_COLUMNS = 'id, vessel_slug, name, vessel_type, make_model, length_ft, homeport, photo_url, description, mmsi, hull_form, loa_m, beam_m, updated_at';
/**
 * A stored hull form, or null for anything this build does not recognise.
 *
 * Never throws and never guesses. A row written by a later release that adds a
 * fourth hull form must still be readable by an app that has not been updated --
 * on a boat, that app may not be updated for a season -- and the honest answer
 * for a value it does not know is "not set", which the chart already handles.
 */
function toHullForm(value) {
    if (typeof value !== 'string')
        return null;
    return exports.HULL_FORMS.some((option) => option.value === value) ? value : null;
}
/**
 * A stored dimension as a number, or null.
 *
 * Stricter than the `Number()` beside it on `length_ft`: `numeric` arrives from
 * PostgREST as a string, and anything that does not parse to a finite number
 * reads as absent rather than as `NaN`. A NaN reaching the chart would be drawn,
 * silently, as a boat of no size.
 */
function toDimension(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function rowToProfile(row) {
    return {
        id: String(row.id ?? ''),
        vesselSlug: String(row.vessel_slug ?? ''),
        name: String(row.name ?? ''),
        vesselType: row.vessel_type ?? null,
        makeModel: row.make_model ?? null,
        lengthFt: row.length_ft === null || row.length_ft === undefined ? null : Number(row.length_ft),
        homeport: row.homeport ?? null,
        mmsi: row.mmsi ?? null,
        photoUrl: row.photo_url ?? null,
        description: row.description ?? null,
        hullForm: toHullForm(row.hull_form),
        loaM: toDimension(row.loa_m),
        beamM: toDimension(row.beam_m),
        updatedAt: row.updated_at ?? null,
    };
}
/**
 * Narrow a select to one vessel, or leave it to RLS.
 *
 * With no target the query carries no filter and the policy does the work:
 * `auth.uid() = user_id` (migrations 027 and 053) means a signed-in client can
 * only see its own rows, so an unfiltered select IS "my vessel". Ordering by
 * `created_at` keeps the answer stable for an account that somehow has two,
 * and `limit(1)` is used rather than `maybeSingle()` because `maybeSingle`
 * treats a second row as an error — the wrong reaction to a state this package
 * should survive rather than refuse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function narrow(query, target) {
    if (typeof target === 'string')
        return query.eq('vessel_slug', target);
    if (target && 'id' in target)
        return query.eq('id', target.id);
    if (target && 'slug' in target)
        return query.eq('vessel_slug', target.slug);
    return query.order('created_at', { ascending: true });
}
/**
 * Read a vessel record. Returns null when the row does not exist or the read
 * fails (offline) — callers keep their local value in that case.
 *
 * With no target this is the caller's own vessel. It used to be
 * `vessel_slug = 'sentinel'`, which every app in the fleet inherited by
 * default and which pointed all of them at the same single row.
 */
async function fetchVesselProfile(supabase, target) {
    try {
        const { data, error } = await narrow(supabase.from('vessels').select(READ_COLUMNS), target).limit(1);
        if (error || !data || data.length === 0)
            return null;
        return rowToProfile(data[0]);
    }
    catch {
        return null;
    }
}
/**
 * The caller's own vessel, as the two things other packages need to address it.
 *
 * `@sentinel/settings` needs both: the uuid to anchor `vessel_settings`, and the
 * slug because `merge_vessel_settings(slug text, …)` kept its signature through
 * migration 053. Exported so that store resolves a vessel the same way this
 * package does, rather than growing a second opinion about which boat is meant
 * — which is the drift this repository exists to prevent.
 */
async function resolveOwnVessel(supabase) {
    const profile = await fetchVesselProfile(supabase);
    if (!profile || !profile.id)
        return null;
    return { id: profile.id, vesselSlug: profile.vesselSlug };
}
/**
 * What is wrong with a patch, in a sentence, or null when there is nothing wrong.
 *
 * Exported so a settings screen can check a field as it is typed, and say which
 * one is out of range, without having to catch anything. `saveVesselProfile`
 * runs the same function, so a UI that validates and a UI that does not agree
 * about what is acceptable.
 *
 * Only the fields the database constrains are checked, and only when the patch
 * carries them: an absent field is not a value, and an explicit `null` clears a
 * column the CHECK allows to be null.
 */
function validateVesselProfilePatch(patch) {
    if (patch.hullForm !== undefined && patch.hullForm !== null && !exports.HULL_FORMS.some((option) => option.value === patch.hullForm)) {
        return `hullForm must be one of ${exports.HULL_FORMS.map((option) => option.value).join(', ')}.`;
    }
    if (patch.loaM !== undefined && patch.loaM !== null) {
        const { exclusiveMin, exclusiveMax } = exports.LOA_M_RANGE;
        if (!Number.isFinite(patch.loaM) || patch.loaM <= exclusiveMin || patch.loaM >= exclusiveMax) {
            return `loaM must be a length in metres greater than ${exclusiveMin} and less than ${exclusiveMax}.`;
        }
    }
    if (patch.beamM !== undefined && patch.beamM !== null) {
        const { exclusiveMin, exclusiveMax } = exports.BEAM_M_RANGE;
        if (!Number.isFinite(patch.beamM) || patch.beamM <= exclusiveMin || patch.beamM >= exclusiveMax) {
            return `beamM must be a beam in metres greater than ${exclusiveMin} and less than ${exclusiveMax}.`;
        }
    }
    return null;
}
/**
 * Write identity fields through to the shared record. Best-effort by design:
 * returns false (and stays quiet) when offline or unauthorised, so callers can
 * treat the shared record as eventually consistent rather than a hard
 * dependency. Requires a signed-in client for name/vesselType (migration 007)
 * and for the hull geometry (migration 066).
 *
 * An out-of-range dimension is the one thing this function is loud about: it
 * throws a `RangeError` before any request is made, rather than returning false.
 * The two failures are not the same and a caller must not treat them alike --
 * `false` means "the boat is offline, try again later", which is a reason to keep
 * the value and retry, while a beam of 300 metres is a value that will never
 * become valid and must be corrected by the person who typed it. Sending it
 * anyway would return false too, from the CHECK, and be indistinguishable from
 * bad signal. Use `validateVesselProfilePatch` to check a field without
 * catching.
 */
async function saveVesselProfile(supabase, patch, target) {
    const invalid = validateVesselProfilePatch(patch);
    if (invalid)
        throw new RangeError(`saveVesselProfile: ${invalid}`);
    const values = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined)
        values.name = patch.name;
    if (patch.vesselType !== undefined)
        values.vessel_type = patch.vesselType;
    if (patch.mmsi !== undefined)
        values.mmsi = patch.mmsi;
    if (patch.hullForm !== undefined)
        values.hull_form = patch.hullForm;
    if (patch.loaM !== undefined)
        values.loa_m = patch.loaM;
    if (patch.beamM !== undefined)
        values.beam_m = patch.beamM;
    if (Object.keys(values).length === 1)
        return true; // nothing to write
    try {
        /*
          An untargeted write resolves to an id first rather than sending an
          unfiltered UPDATE.
    
          RLS would confine such an update to the caller's own rows, so it would not
          corrupt anyone else's boat -- but an account with two vessels would have
          both rewritten, and a write is the wrong place to find that out. Reading
          first costs one round trip and makes the statement name its row.
        */
        const own = target === undefined ? await resolveOwnVessel(supabase) : null;
        if (target === undefined && !own)
            return false;
        const resolved = target ?? { id: own.id };
        const { error } = await narrow(supabase.from('vessels').update(values), resolved);
        return !error;
    }
    catch {
        return false;
    }
}
/**
 * The types an app should offer, with what each one implies.
 *
 * Not exhaustive and not meant to be — it is a shortlist that covers the
 * cruising fleet, and `propulsionFor` handles anything typed outside it. The
 * two catamaran entries are spelled out rather than left as one because a
 * bare "Catamaran" is the single most ambiguous answer an owner can give, and
 * guessing it wrong picks the wrong performance model in silence.
 */
exports.VESSEL_TYPES = [
    { value: 'Sloop', label: 'Sloop', propulsion: 'sail' },
    { value: 'Cutter', label: 'Cutter', propulsion: 'sail' },
    { value: 'Ketch', label: 'Ketch', propulsion: 'sail' },
    { value: 'Yawl', label: 'Yawl', propulsion: 'sail' },
    { value: 'Schooner', label: 'Schooner', propulsion: 'sail' },
    { value: 'Sailing catamaran', label: 'Sailing catamaran', propulsion: 'sail' },
    { value: 'Sailing trimaran', label: 'Sailing trimaran', propulsion: 'sail' },
    { value: 'Motorsailer', label: 'Motorsailer', propulsion: 'sail' },
    { value: 'Trawler', label: 'Trawler', propulsion: 'power' },
    { value: 'Motor yacht', label: 'Motor yacht', propulsion: 'power' },
    { value: 'Express cruiser', label: 'Express cruiser', propulsion: 'power' },
    { value: 'Sportfish', label: 'Sportfish', propulsion: 'power' },
    { value: 'Power catamaran', label: 'Power catamaran', propulsion: 'power' },
    { value: 'Downeast cruiser', label: 'Downeast cruiser', propulsion: 'power' },
    { value: 'Centre console', label: 'Centre console', propulsion: 'power' },
    { value: 'RIB', label: 'RIB', propulsion: 'power' }
];
/**
 * Words that settle it, most specific first.
 *
 * Order matters and is the whole subtlety. "Power catamaran" contains
 * "catamaran", "motorsailer" contains "motor", and "sailfish" is a fish. So
 * the compound and trap cases are tested before the bare ones, and each entry
 * matches whole words rather than substrings.
 */
const PROPULSION_HINTS = [
    // Compounds that would otherwise be decided by the wrong half.
    { pattern: /motor[\s-]?sail|sail[\s-]?motor/, propulsion: 'sail' },
    { pattern: /power[\s-]?(cat|catamaran|tri|trimaran)/, propulsion: 'power' },
    { pattern: /sail(ing)?[\s-]?(cat|catamaran|tri|trimaran)/, propulsion: 'sail' },
    // Rigs. A boat described by its rig is a sailing boat, whatever else it says.
    { pattern: /\b(sloop|cutter|ketch|yawl|schooner|gaff|cat[\s-]?rig|sailboat|sailing yacht|s\/v)\b/, propulsion: 'sail' },
    // Motorboat types.
    {
        pattern: /\b(trawler|motor yacht|motoryacht|motorboat|motor boat|express cruiser|sportfish|sport fish|sportfisher|downeast|centre console|center console|rib|runabout|pilothouse|powerboat|power boat|tug|m\/v|m\/y)\b/,
        propulsion: 'power'
    },
    // Bare "motor"/"power"/"sail" last, so the compounds above always win.
    { pattern: /\b(motor|power|diesel|outboard|inboard)\b/, propulsion: 'power' },
    { pattern: /\bsail\b/, propulsion: 'sail' }
];
/**
 * Read a propulsion out of whatever is in `vessel_type`.
 *
 * Defaults to sail, and that default is not neutral — it is the conservative
 * one. Every vessel already in the fleet's records predates this function, was
 * planned as a sailing boat, and has a polar chosen for it; reading an
 * unrecognised type as power would swap the performance model under an
 * existing user without them touching anything. A boat that has never been
 * described gets the behaviour it has always had, and the owner changes it in
 * the profile the moment it is wrong.
 */
function propulsionFor(vesselType) {
    const text = String(vesselType ?? '').trim().toLowerCase();
    if (!text)
        return 'sail';
    const exact = exports.VESSEL_TYPES.find((t) => t.value.toLowerCase() === text);
    if (exact)
        return exact.propulsion;
    for (const hint of PROPULSION_HINTS) {
        if (hint.pattern.test(text))
            return hint.propulsion;
    }
    return 'sail';
}
/** "S/V" or "M/V", for labelling a vessel the way its owner would. */
function vesselPrefix(propulsion) {
    return propulsion === 'power' ? 'M/V' : 'S/V';
}
