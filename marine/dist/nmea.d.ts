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
}
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
