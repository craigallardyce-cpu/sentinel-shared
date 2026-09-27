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
    /** Depth of water below the waterline, in feet. See `depth_offset_ft`. */
    depth: number | null;
    /**
     * How far the transducer sits below the waterline, in feet, as reported by
     * DPT. Kept so that DBT — which measures from the transducer rather than the
     * surface — can be raised to the same datum instead of contradicting DPT.
     */
    depth_offset_ft: number | null;
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
/** Parses a single NMEA sentence and returns an object of parsed telemetry fields. */
export declare function parseNmeaSentence(sentence: string): any;
/** Parses an NMEA sentence and updates a shared live-data object in place. */
export declare function handleNmeaSentence(sentence: string, liveData: NmeaLiveData): void;
