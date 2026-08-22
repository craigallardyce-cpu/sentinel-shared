/**
 * Boat performance model — the polar diagram a router optimises against.
 *
 * A polar answers one question: given a true wind angle and a true wind speed,
 * how fast does this boat go? Everything the routing engine decides follows
 * from that, which is why the polar is the single largest source of error in a
 * routed passage. A generic polar produces a plausible route; the boat's own
 * measured polar produces a useful one.
 */
export interface PolarDiagram {
    /** Human label, e.g. "Cruising monohull ~40ft (generic)". */
    name: string;
    /** True wind speeds in knots, ascending. */
    twsValues: number[];
    /** True wind angles in degrees 0-180, ascending. */
    twaValues: number[];
    /** speeds[twaIndex][twsIndex] in knots. */
    speeds: number[][];
    /**
     * True when this is an approximation rather than the vessel's own measured
     * performance, so callers can say so rather than implying precision.
     */
    generic?: boolean;
}
/** Fold any angle into 0-180: a polar is symmetric about the wind axis. */
export declare function foldTwa(twaDeg: number): number;
/**
 * Boat speed in knots for a wind angle and strength, bilinearly interpolated.
 *
 * Wind stronger than the polar describes is clamped to its top row rather than
 * extrapolated: beyond the last measured column a boat is reefing, and a curve
 * fitted upward there would promise speed that reefed sail cannot deliver.
 */
export declare function boatSpeed(polar: PolarDiagram, twaDeg: number, twsKts: number): number;
export interface VmgResult {
    /** True wind angle giving the best velocity made good, or null if none does. */
    twaDeg: number | null;
    /** Speed made good toward (upwind) or away from (downwind) the wind, in knots. */
    vmgKts: number;
    /** Boat speed at that angle. */
    boatSpeedKts: number;
}
/**
 * Best upwind or downwind angle for a given wind strength.
 *
 * Not used by the isochrone search, which discovers these angles for itself by
 * trying every heading — it exists so a route summary can say "close hauled at
 * 42°" and so a polar can be sanity-checked after import.
 */
export declare function bestVmg(polar: PolarDiagram, twsKts: number, direction: 'upwind' | 'downwind'): VmgResult;
/**
 * Parse the .pol / .csv table used by most routing software: a header row of
 * true wind speeds, then one row per true wind angle.
 *
 *   twa/tws  6    8    10
 *   40       3.8  4.6  5.2
 *   60       4.9  5.8  6.4
 *
 * Tabs, semicolons, commas or runs of spaces all separate columns, because
 * exports in the wild use all four.
 */
export declare function parsePolarFile(text: string, name?: string): PolarDiagram;
/**
 * Generic polars, for planning before a boat's own numbers exist.
 *
 * These are shape-plausible approximations for their type, not measurements of
 * any particular hull. They are good enough to compare one departure time
 * against another — which is most of what routing is for — and not good enough
 * to promise an ETA. Rows below the type's pointing angle are zero, so the
 * router tacks rather than pretending a boat sails into the wind.
 */
export declare const GENERIC_POLARS: Record<string, PolarDiagram>;
