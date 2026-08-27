/**
 * AIS (AIVDM/AIVDO) decoding and tactical collision-assessment utilities
 * shared across the Mariner Sentinel fleet.
 */
export interface AisTargetData {
    mmsi: string;
    name?: string;
    callSign?: string;
    type?: string;
    lat?: number;
    lon?: number;
    sog?: number;
    cog?: number;
    heading?: number;
    isOwnVessel?: boolean;
    lastSeen?: number;
}
export interface TargetMetrics {
    rangeVal: number;
    bearingVal: number;
    cpaVal: number;
    tcpaVal: number;
    range: string;
    bearing: string;
    cpa: string;
    tcpa: string;
    threatLevel: 'SAFE' | 'ADVISORY';
}
/** Parses raw NMEA AIVDM / AIVDO sentences into AIS target data. */
export declare function parseAisSentence(sentence: string): AisTargetData | null;
/** Calculates CPA, TCPA, Range, Bearing, and Threat Level between Own Ship and Target. */
export declare function calculateTargetMetrics(ownLat: number, ownLon: number, ownSog: number | undefined, ownCog: number | undefined, tgtLat: number, tgtLon: number, tgtSog?: number, tgtCog?: number): TargetMetrics;
/** Generates or updates the target list, recalculating relative motion against own ship. */
export declare function getUpdatedAisTargets(currentTargetsMap: Map<string, any>, ownShipLat: number, ownShipLon: number, ownShipSog?: number, ownShipCog?: number, ownMmsi?: string | null, options?: {
    /**
     * Whether this vessel carries a transmitting transponder. Receive-only
     * installations never appear in their own feed, so there is no own-ship echo
     * to guard against and the proximity fallback below would only blind them.
     * Defaults to true, which keeps the previous behaviour for every caller.
     */
    ownShipTransmits?: boolean;
}): {
    targetsList: any[];
    targetsMap: Map<string, any>;
};
