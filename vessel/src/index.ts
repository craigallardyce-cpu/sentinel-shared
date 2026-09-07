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
  /**
   * The vessel's identity, and what everything else should reference.
   *
   * Stable across a rename, which `vesselSlug` is not: the slug is the display
   * handle the public logbook URL is built from, and an owner renaming their
   * boat changes it. Migration 053 (MarinerSentinel Website) made this the
   * primary key for exactly that reason.
   */
  id: string;
  /** The display handle, unique across the fleet. Changes when the boat is renamed. */
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

/**
 * Which vessel a helper acts on.
 *
 * Omitted means **the caller's own** — the row whose `user_id` is the signed-in
 * account, which RLS already restricts the client to seeing. That is what every
 * call site in the fleet has always meant: all five of them called these helpers
 * with no target at all and silently got `vessel_slug = 'sentinel'`, a literal
 * that was correct while there was one boat in the database and wrong for the
 * second customer to sign up.
 *
 * A string is read as a slug, so anything that was passing one still works.
 */
export type VesselTarget = string | { id: string } | { slug: string };

/** Columns clients may SELECT (kept in sync with migrations 002, 007 and 053). */
const READ_COLUMNS = 'id, vessel_slug, name, vessel_type, make_model, length_ft, homeport, photo_url, description, mmsi, updated_at';

// Deliberately loose: any @supabase/supabase-js client (or compatible mock)
// fits without this package depending on the library — and without TypeScript
// trying to reconcile the client's deep generics against a structural type
// (which trips TS2589 in consumers).
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

function rowToProfile(row: Record<string, unknown>): VesselProfile {
  return {
    id: String(row.id ?? ''),
    vesselSlug: String(row.vessel_slug ?? ''),
    name: String(row.name ?? ''),
    vesselType: (row.vessel_type as string | null) ?? null,
    makeModel: (row.make_model as string | null) ?? null,
    lengthFt: row.length_ft === null || row.length_ft === undefined ? null : Number(row.length_ft),
    homeport: (row.homeport as string | null) ?? null,
    mmsi: (row.mmsi as string | null) ?? null,
    photoUrl: (row.photo_url as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
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
function narrow(query: any, target?: VesselTarget): any {
  if (typeof target === 'string') return query.eq('vessel_slug', target);
  if (target && 'id' in target) return query.eq('id', target.id);
  if (target && 'slug' in target) return query.eq('vessel_slug', target.slug);
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
export async function fetchVesselProfile(supabase: SupabaseLike, target?: VesselTarget): Promise<VesselProfile | null> {
  try {
    const { data, error } = await narrow(supabase.from('vessels').select(READ_COLUMNS), target).limit(1);
    if (error || !data || data.length === 0) return null;
    return rowToProfile(data[0]);
  } catch {
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
export async function resolveOwnVessel(supabase: SupabaseLike): Promise<{ id: string; vesselSlug: string } | null> {
  const profile = await fetchVesselProfile(supabase);
  if (!profile || !profile.id) return null;
  return { id: profile.id, vesselSlug: profile.vesselSlug };
}

/**
 * Write identity fields through to the shared record. Best-effort by design:
 * returns false (and stays quiet) when offline or unauthorised, so callers can
 * treat the shared record as eventually consistent rather than a hard
 * dependency. Requires a signed-in client for name/vesselType (migration 007).
 */
export async function saveVesselProfile(supabase: SupabaseLike, patch: VesselProfilePatch, target?: VesselTarget): Promise<boolean> {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.vesselType !== undefined) values.vessel_type = patch.vesselType;
  if (patch.mmsi !== undefined) values.mmsi = patch.mmsi;
  if (Object.keys(values).length === 1) return true; // nothing to write
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
    if (target === undefined && !own) return false;
    const resolved: VesselTarget = target ?? { id: own!.id };
    const { error } = await narrow(supabase.from('vessels').update(values), resolved);
    return !error;
  } catch {
    return false;
  }
}

/**
 * How the vessel is driven — and why it is a fleet-wide fact rather than an
 * OceanSentinel one.
 *
 * The planner needs it because a sailing boat and a motorboat are not the same
 * optimisation. A sailing boat's speed IS a function of the wind, so routing
 * it means finding wind; a motorboat's speed is a throttle setting the weather
 * only ever takes away from, so routing it means avoiding weather and watching
 * the fuel. Everything downstream forks on that one bit: which performance
 * model applies, whether "tack" and "gybe" mean anything, whether a calm is a
 * problem or a gift, and whether running out of fuel ends the passage or
 * merely slows it.
 *
 * It lives here, on the identity record, because it is identity: a Nordhavn is
 * not a Nordhavn with the sail option turned off. That also means all three
 * apps read the same answer instead of each keeping a private opinion — the
 * exact drift this package exists to prevent.
 *
 * The storage is the existing free-text `vessel_type` column, deliberately.
 * VesselKeeper has been writing it for as long as it has had a profile editor,
 * the grants for it are already right (migration 007 lets a signed-in client
 * update it), and adding a parallel boolean would mean a migration, two
 * sources of truth, and a first release where they disagree. So the type is
 * the record and the propulsion is derived from it — which is why
 * `propulsionFor` has to cope with whatever is already in that column rather
 * than only with the values `VESSEL_TYPES` offers.
 */
export type Propulsion = 'sail' | 'power';

export interface VesselTypeOption {
  /** Stored verbatim in `vessels.vessel_type`. */
  value: string;
  label: string;
  propulsion: Propulsion;
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
export const VESSEL_TYPES: VesselTypeOption[] = [
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
const PROPULSION_HINTS: Array<{ pattern: RegExp; propulsion: Propulsion }> = [
  // Compounds that would otherwise be decided by the wrong half.
  { pattern: /motor[\s-]?sail|sail[\s-]?motor/, propulsion: 'sail' },
  { pattern: /power[\s-]?(cat|catamaran|tri|trimaran)/, propulsion: 'power' },
  { pattern: /sail(ing)?[\s-]?(cat|catamaran|tri|trimaran)/, propulsion: 'sail' },
  // Rigs. A boat described by its rig is a sailing boat, whatever else it says.
  { pattern: /\b(sloop|cutter|ketch|yawl|schooner|gaff|cat[\s-]?rig|sailboat|sailing yacht|s\/v)\b/, propulsion: 'sail' },
  // Motorboat types.
  {
    pattern:
      /\b(trawler|motor yacht|motoryacht|motorboat|motor boat|express cruiser|sportfish|sport fish|sportfisher|downeast|centre console|center console|rib|runabout|pilothouse|powerboat|power boat|tug|m\/v|m\/y)\b/,
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
export function propulsionFor(vesselType?: string | null): Propulsion {
  const text = String(vesselType ?? '').trim().toLowerCase();
  if (!text) return 'sail';
  const exact = VESSEL_TYPES.find((t) => t.value.toLowerCase() === text);
  if (exact) return exact.propulsion;
  for (const hint of PROPULSION_HINTS) {
    if (hint.pattern.test(text)) return hint.propulsion;
  }
  return 'sail';
}

/** "S/V" or "M/V", for labelling a vessel the way its owner would. */
export function vesselPrefix(propulsion: Propulsion): string {
  return propulsion === 'power' ? 'M/V' : 'S/V';
}
