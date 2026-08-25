import { type RouteResult, type RouteFront, type WaveSampler, type WindSampler } from './routing.js';
/**
 * The advisory corridor, and the weather it is advising about.
 *
 * This is the underway half of the router, and it is a SAFETY feature: its job
 * is to notice conditions that have appeared in a passage since it was planned,
 * and to show the water that stays clear of them. Arriving sooner is a side
 * effect of avoidance and never the headline — which is why nothing in this
 * file produces a heading. "Avoid that" is a complete sentence; "steer 165" is
 * not this app's to say, and would be a navigational claim it cannot support.
 *
 * Two things are computed here:
 *
 *   - `scanHazards` walks a planned track against a forecast and reports where
 *     and WHEN it runs into conditions above the crew's limits. Given the
 *     forecast the passage was originally planned from, it also reports which
 *     of those are new — the ones nobody knew about at departure, which is the
 *     entire product.
 *   - `buildCorridor` turns the router's retained fronts into bands of water
 *     that are both reachable and clear. Its width is measured, not drawn: a
 *     band is wide where the boat has options and pinches where the weather
 *     takes them away. Nobody designs the pinch.
 */
export interface HazardLimits {
    /** Sustained wind, knots. Default 30 — the second reef for most cruisers. */
    windKts?: number;
    /** Gust, knots. Default 40. */
    gustKts?: number;
    /** Significant wave height, metres. Default 4. */
    waveM?: number;
}
export interface Breach {
    kind: 'wind' | 'gust' | 'sea';
    value: number;
    limit: number;
    /** True where this particular limit was not being broken at departure. */
    isNew: boolean;
}
export interface Hazard {
    lat: number;
    lon: number;
    /** When the boat is due to be here, ISO. */
    time: string;
    hoursAway: number;
    /** Which limits this position breaks, in the order they should be read. */
    breaches: Breach[];
    /**
     * True where at least one breach here was not in the forecast the passage
     * was PLANNED from.
     *
     * The reason the feature exists. A gale that was in the plan is one the
     * skipper already accepted; a gale that has appeared since is the one nobody
     * has decided about yet.
     *
     * Judged per BREACH rather than per position, which matters more than it
     * sounds: a leg that always had a big sea and has since grown forty-knot
     * gusts is a new hazard, and asking only "was anything wrong here before"
     * would answer yes and say nothing.
     */
    isNew: boolean;
}
export interface HazardScan {
    hazards: Hazard[];
    /** The worst thing found, or null. Whatever leads the advisory. */
    worst: Hazard | null;
    /** The first one in time, which is what the crew meets first. */
    soonest: Hazard | null;
    /** True where a previous forecast was supplied, so `isNew` means something. */
    comparedToPlan: boolean;
    limits: Required<HazardLimits>;
}
export interface Samplers {
    wind: WindSampler;
    waves?: WaveSampler;
}
/**
 * Walk a planned track against a forecast and report what it runs into.
 *
 * Sampled at the track's own legs, which is the right resolution: the legs are
 * where the boat is expected to be, hour by hour, and a hazard the boat does
 * not pass through is not this feature's business — the wind overlay already
 * shows the weather everywhere.
 *
 * `plannedWith` is the forecast the passage was originally planned from. Given
 * it, each hazard is marked new or not. Without it every hazard is reported as
 * not new, which is honest: with nothing to compare against, nobody can say
 * whether this was known at departure.
 */
export declare function scanHazards(route: RouteResult, samplers: Samplers, options?: {
    limits?: HazardLimits;
    plannedWith?: Samplers;
    now?: number;
}): HazardScan;
export interface CorridorBand {
    timeMs: number;
    hoursFromDeparture: number;
    /** Clear, reachable positions at this hour. Never a path — an unordered set. */
    points: Array<{
        lat: number;
        lon: number;
    }>;
    /**
     * How much water the boat has at this hour, in nautical miles across.
     *
     * The number behind the pinch. Measured as the greatest separation between
     * any two clear positions on the front, which is the honest answer to "how
     * much room is there" and needs no centreline to compute.
     */
    widthNm: number;
}
export interface Corridor {
    bands: CorridorBand[];
    /**
     * The band where the boat's options are narrowest, or null.
     *
     * The safety message in geometry: the hour at which the choice closes. Only
     * reported where it is meaningfully narrower than the widest band, because a
     * uniformly wide corridor has no decision in it and inventing one would be
     * exactly the false precision this feature exists to avoid.
     */
    pinch: CorridorBand | null;
    /** Widest band, for scale. */
    widest: CorridorBand | null;
}
/**
 * Turn the router's retained fronts into bands of clear, reachable water.
 *
 * The corridor is NOT a buffer around the optimal track. It is the reachable
 * set minus the water the boat must not be in, which is why its width means
 * something: wide where the boat has options, narrow where the weather has
 * taken them. A band with no clear points at all is dropped rather than drawn
 * empty — there is no advice to give for an hour with nowhere to be.
 */
export declare function buildCorridor(fronts: RouteFront[]): Corridor;
/**
 * The advisory, in the order it should be read.
 *
 * What is wrong, then where not to be, then what to do, then what it costs. A
 * speed feature would invert this list, and the inversion is the whole
 * difference between the two products — so it is expressed here, once, rather
 * than left to whoever writes the screen.
 */
export interface Advisory {
    /** The headline: the worst NEW hazard, or the worst known one, or null. */
    headline: Hazard | null;
    /** True when the headline is something that was not in the original plan. */
    headlineIsNew: boolean;
    scan: HazardScan;
    corridor: Corridor;
    /** Hours this route takes against the plan as filed, where both are known. */
    costHours: number | null;
}
export declare function buildAdvisory(route: RouteResult, scan: HazardScan, corridor: Corridor, filedEtaHours?: number | null): Advisory;
/**
 * A point on the filed passage, with what the forecast said about it AT THE
 * TIME IT WAS FILED.
 *
 * Kept on the plan record rather than recomputed, and that is the whole point:
 * it is the written-down expectation. A comparison that re-derived the "plan"
 * from a forecast fetched today would be comparing today with today and would
 * always report that nothing had changed.
 */
export interface PlanCheckpoint {
    lat: number;
    lon: number;
    /** When the plan expected the boat to be here, ISO. */
    time: string;
    windKts: number | null;
    gustKts: number | null;
    waveM: number | null;
}
export type SegmentVerdict = 'tracking' | 'easing' | 'worsening' | 'unknown';
export interface PlanSegment {
    time: string;
    hoursAway: number;
    lat: number;
    lon: number;
    verdict: SegmentVerdict;
    plannedWindKts: number | null;
    nowWindKts: number | null;
    windDeltaKts: number | null;
    plannedWaveM: number | null;
    nowWaveM: number | null;
    waveDeltaM: number | null;
}
export interface PlanComparison {
    segments: PlanSegment[];
    /** The worst verdict anywhere still ahead — what the headline should say. */
    verdict: SegmentVerdict;
    /** Where it stops tracking, or null if it never does. */
    divergesAt: PlanSegment | null;
    /** How much of the remaining passage is still going to plan, 0-1. */
    trackingFraction: number;
}
/**
 * Compare the passage still ahead against what was expected when it was filed.
 *
 * This is the other half of the safety story. `scanHazards` answers "is
 * anything dangerous", which is binary and only fires at the limits; this
 * answers "is the passage still the one I planned", which is the question a
 * skipper asks every watch and which has a useful answer long before anything
 * is dangerous.
 *
 * Only the future is compared. What the weather did yesterday is not a
 * forecast any more, it is history, and reporting that it diverged is telling
 * somebody about a decision they can no longer make.
 */
export declare function compareToPlan(checkpoints: PlanCheckpoint[], samplers: Samplers, options?: {
    now?: number;
    windToleranceKts?: number;
    waveToleranceM?: number;
}): PlanComparison;
