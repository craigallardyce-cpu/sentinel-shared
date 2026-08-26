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
export declare const VESSEL_TYPES: VesselTypeOption[];
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
export declare function propulsionFor(vesselType?: string | null): Propulsion;
/** "S/V" or "M/V", for labelling a vessel the way its owner would. */
export declare function vesselPrefix(propulsion: Propulsion): string;
