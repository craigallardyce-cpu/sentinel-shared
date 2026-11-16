/**
 * NMEA 0183 sentence parsing shared across the Mariner Sentinel fleet.
 */
import { type AisTargetData } from './ais.js';
export declare const liveAisTargetsMap: Map<string, AisTargetData>;
/** Auto-detected own vessel MMSI (latched from AIVDO sentences). */
export declare let ownVesselMmsi: string | null;
/** Shared data structure for the latest parsed NMEA values. */
export interface NmeaLiveData {
    lat: number | null;
    lon: number | null;
    w_speed: number | null;
    w_dir: number | null;
    /**
     * The sounder's depth in feet, on the datum `depth_datum` names. It is the
     * depth of water only when that datum is 'surface'.
     */
    depth: number | null;
    /**
     * What `depth` is measured from: the waterline, the transducer, or the keel.
     * Null until a sounding has arrived, and on an object built before this
     * field existed.
     *
     * A sounder set up with a keel offset reports depth below the keel, and this
     * used to be handed on as depth of water. Scope worked out from it read
     * better than it was, so the datum now travels with the number and the app
     * decides what it can honestly show.
     */
    depth_datum?: DepthDatum | null;
    /**
     * DPT's offset in feet, signed as the sentence gives it: positive is how far
     * the transducer sits below the waterline, negative how far the keel sits
     * below the transducer. Kept so that DBT, which measures from the transducer,
     * can be moved to the same datum instead of contradicting DPT.
     */
    depth_offset_ft: number | null;
    /** Bookkeeping for `resolveDepth`. Not for display. */
    depth_state?: DepthState;
    /**
     * Whether `w_speed` is the true wind or the apparent wind. A feed carrying
     * both used to make the figure alternate between the two.
     */
    w_speed_ref?: 'true' | 'apparent' | null;
    /** When a true wind speed last arrived, as `Date.now()`. Bookkeeping. */
    w_speed_true_at?: number | null;
    /** Magnetic variation in degrees, east positive, when RMC or HDG has given one. */
    mag_var?: number | null;
    sentenceCount: number;
    lastUpdate: number;
    /**
     * When a position fix was last ACCEPTED, as `Date.now()`. Null until one has
     * been.
     *
     * Deliberately not `lastUpdate`, which moves for a depth sounding or a wind
     * reading just as readily as for a fix. An anchor watch asking "do I still
     * know where the boat is" cannot be answered by a field a wind vane keeps
     * fresh -- the instruments carry on reporting long after the GPS has stopped,
     * so `lastUpdate` stays current while the position quietly goes stale. This
     * field moves only when `lat`/`lon` are written.
     */
    lastFixAt: number | null;
}
/**
 * How old a fix may be and still count as live, in milliseconds.
 *
 * Craig's call, 2026-09-27: a fix older than ten seconds is not a live fix, and
 * a position-lost alarm fires after ten seconds without one. A gateway at 1 Hz
 * has missed ten fixes by then, so this is not tight.
 */
export declare const FIX_MAX_AGE_MS = 10000;
/**
 * Whether a fix taken at `lastFixAt` is still live.
 *
 * Pure, and takes `now` so the alarm's tests do not depend on the clock. Never
 * having had a fix is not freshness: null and undefined are both false, so a
 * caller cannot get a live answer out of a feed that has produced nothing.
 */
export declare function isFixFresh(lastFixAt: number | null | undefined, now?: number, maxAgeMs?: number): boolean;
export declare function createNmeaLiveData(): NmeaLiveData;
/** Validates NMEA sentence checksum (XOR of all chars between $/! and *). */
export declare function validateNmeaChecksum(sentence: string): boolean;
/** Parses NMEA latitude field (DDMM.MMM format). */
export declare function parseNmeaLatitude(val: string, hemi: string): number | null;
/** Parses NMEA longitude field (DDDMM.MMM format). */
export declare function parseNmeaLongitude(val: string, hemi: string): number | null;
/** Formats coordinates to a display string, e.g. "N 41° 18.660'". */
export declare function formatCoords(lat: number, lng: number): {
    latStr: string;
    lngStr: string;
};
/**
 * Whether a position sentence's mode indicator describes a fix the receiver
 * actually has.
 *
 * NMEA 2.3 added the field to RMC and GLL. E is estimated (dead reckoning), M
 * is typed in by hand and N is no fix: a receiver that has lost its satellites
 * can go on sending status A with mode E, and each of those sentences used to
 * refresh `lastFixAt`, so the position-lost alarm stayed quiet while the
 * receiver extrapolated. S (simulator) is accepted on purpose: a simulated feed
 * is one somebody connected deliberately, to try the app or to test it. An
 * absent field is an older talker and is taken at its status flag.
 */
export declare function isLiveFixMode(mode: string | undefined | null): boolean;
/**
 * Whether a GGA quality field describes a fix the receiver actually has: 1 GPS,
 * 2 differential, 3 PPS, 4 and 5 RTK, 8 simulator (see `isLiveFixMode`). 0 is no
 * fix, 6 is estimated and 7 is manual; a field that is not a number is not a
 * fix either.
 */
export declare function isLiveFixQuality(quality: string | undefined | null): boolean;
/**
 * True heading from whatever a feed supplies: a true heading as it is, or a
 * magnetic heading corrected by the variation (east positive). Undefined when
 * neither can be had. Course over ground is not a heading and is never used
 * here; an app that wants to fall back to it says so in its own code.
 */
export declare function resolveTrueHeading(input: {
    heading?: number | null;
    headingMagnetic?: number | null;
    magVar?: number | null;
}): number | undefined;
/** What a depth is measured from. */
export type DepthDatum = 'surface' | 'transducer' | 'keel';
/** What `resolveDepth` remembers between sentences. */
export interface DepthState {
    /** DPT's offset in metres, signed as sent. Null until one has arrived. */
    offsetM: number | null;
    /** The datum of the last reading accepted. */
    datum: DepthDatum | null;
    /** When that reading was accepted, as `Date.now()`. */
    at: number;
}
export interface DepthReading {
    depthM: number;
    datum: DepthDatum;
}
/**
 * How long a better datum holds off a worse one. A sounder that sends DBT, DBK
 * and DBS sends them every cycle, so anything longer than a few cycles keeps
 * one datum on screen; when the better sentence stops, the worse one is taken
 * again after this long.
 */
export declare const DEPTH_DATUM_HOLD_MS = 10000;
export declare function createDepthState(): DepthState;
/**
 * One depth, on one datum, from a stream of depth sentences.
 *
 * DBT measures from the transducer, DBK from the keel and DBS from the surface,
 * and DPT measures from the transducer and says how to move the reading: a
 * positive offset to the waterline, a negative one to the keel. A sounder that
 * sends more than one of them used to make the depth jump between datums on
 * every cycle, and a keel offset was added as if it were a waterline offset and
 * the result called depth of water.
 *
 * Call it with every parsed sentence. It returns a reading when the sentence
 * carried a depth on the best datum the feed is currently supplying, and null
 * otherwise, so the caller keeps what it had.
 */
export declare function resolveDepth(state: DepthState, parsed: any, now?: number): DepthReading | null;
/**
 * How long a true wind speed holds off an apparent one in `w_speed`. See
 * `NmeaLiveData.w_speed_ref`.
 */
export declare const WIND_TRUE_HOLD_MS = 10000;
/**
 * Parses a single NMEA sentence and returns an object of parsed telemetry fields.
 *
 * A field the sentence left empty is ABSENT from the result, never present as
 * `undefined`. Callers merge these objects into what they already hold, and a
 * key that is present overwrites: RMC used to return `magVar: undefined` and
 * erase the variation HDG had supplied a moment earlier.
 */
export declare function parseNmeaSentence(sentence: string): any;
/** Parses an NMEA sentence and updates a shared live-data object in place. */
export declare function handleNmeaSentence(sentence: string, liveData: NmeaLiveData): void;
