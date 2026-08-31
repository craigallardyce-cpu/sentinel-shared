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
/**
 * Relative-motion figures for one target against own ship.
 *
 * Every angle here is TRUE, not magnetic. Bearings are derived from geographic
 * coordinates and COG comes straight off the AIS report, which is referenced to
 * true north; no magnetic variation is applied anywhere in this module.
 */
export interface TargetMetrics {
    rangeVal: number;
    /** True bearing to the target, degrees 0-360. */
    bearingVal: number;
    cpaVal: number;
    tcpaVal: number;
    range: string;
    bearing: string;
    cpa: string;
    tcpa: string;
    threatLevel: 'SAFE' | 'ADVISORY';
}
/**
 * A decoded target after getUpdatedAisTargets has enriched it with relative
 * motion against own ship.
 *
 * The display strings are deliberately named apart from the numeric fields they
 * are derived from. `heading` stays what the decoder produced -- the target's
 * true heading in degrees -- and is no longer overwritten with a formatted
 * course string, which had made it a number by declaration and a string in
 * practice. Anything needing course over ground should read the numeric `cog`.
 */
export interface AisTargetEnriched extends AisTargetData, TargetMetrics {
    id: string;
    name: string;
    sog: number;
    cog: number;
    /** [lat, lon], convenient for Leaflet. */
    coords: [number, number];
    /** SOG formatted for display, e.g. "5.2 kts". */
    sogText: string;
    /**
     * COG formatted for display, e.g. "045° T". True, not magnetic: AIS position
     * reports carry COG relative to true north and nothing here applies variation.
     */
    cogText: string;
}
/** Parses raw NMEA AIVDM / AIVDO sentences into AIS target data. */
export declare function parseAisSentence(sentence: string): AisTargetData | null;
/** Calculates CPA, TCPA, Range, Bearing, and Threat Level between Own Ship and Target. */
export declare function calculateTargetMetrics(ownLat: number, ownLon: number, ownSog: number | undefined, ownCog: number | undefined, tgtLat: number, tgtLon: number, tgtSog?: number, tgtCog?: number): TargetMetrics;
/**
 * Generates or updates the target list, recalculating relative motion against
 * own ship.
 *
 * Own ship is identified by IDENTITY ONLY — never by how close a target is.
 * A vessel is recognised as ourselves when it arrives as AIVDO, when it carries
 * an MMSI already latched from an AIVDO sentence, or when its MMSI is one the
 * caller names in `ownMmsi`. Nothing else removes a target.
 *
 * There was once a fallback here that dropped anything within 0.03 NM as a
 * presumed own-ship echo. It is gone, and must not come back: the nearest
 * vessel is the one an anchor watch exists to warn about, and a rule that
 * silently hides whatever comes closest defeats the alarm at exactly the moment
 * it matters. A boat anchoring 50 m away is not an echo. When identity is
 * genuinely unknown the right outcome is a spurious extra target the skipper
 * can see and dismiss, not a real one nobody is told about.
 *
 * `ownMmsi` accepts several identities so a caller can offer everything it
 * knows at once — configured, from the vessel profile, and learned from AIVDO.
 */
export declare function getUpdatedAisTargets(currentTargetsMap: Map<string, any>, ownShipLat: number, ownShipLon: number, ownShipSog?: number, ownShipCog?: number, ownMmsi?: string | string[] | null): {
    targetsList: AisTargetEnriched[];
    targetsMap: Map<string, any>;
};
