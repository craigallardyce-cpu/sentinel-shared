import { type PolarDiagram } from './polars.js';
import type { ObstacleField } from './obstacles.js';
/** Great-circle distance in nautical miles. */
export declare function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** Initial great-circle bearing in degrees. */
export declare function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** The point reached by steering a bearing for a distance. */
export declare function destinationPoint(lat: number, lon: number, bearing: number, distNm: number): {
    lat: number;
    lon: number;
};
/** Smallest angle between two bearings, 0-180. */
export declare function angleBetween(a: number, b: number): number;
export interface WindSample {
    speedKts: number;
    /** Direction the wind is coming FROM, in degrees true. */
    directionDeg: number;
    /**
     * Gust speed in knots, where the model publishes one. Optional, and never
     * routed on — the boat sails its polar in the mean wind and reefs for the
     * gusts. Reported so a passage summary can say what the boat will be set up
     * for.
     */
    gustKts?: number | null;
}
/** Wind at a place and moment, or null where the forecast does not reach. */
export type WindSampler = (lat: number, lon: number, timeMs: number) => WindSample | null;
export interface WaveSample {
    /** Significant wave height in metres. */
    heightM: number;
    /** Direction the sea is running FROM, in degrees true — the wind convention. */
    directionDeg: number;
    /** Mean wave period in seconds, where the model gives one. Reported, not used. */
    periodS: number | null;
}
/** Sea state at a place and moment, or null where the forecast does not reach. */
export type WaveSampler = (lat: number, lon: number, timeMs: number) => WaveSample | null;
export interface SeaStateOptions {
    /**
     * Waterline length the penalty is scaled against, in metres. Speed lost to
     * waves goes roughly as the inverse of length — a 12 m boat is stopped by a
     * sea a 24 m one sails through — and the polar does not carry a length, so
     * this is where one comes from. Default 12 m, the ~40 ft cruiser the generic
     * polars describe.
     */
    referenceLengthM?: number;
    /** Scale of the whole penalty. Default 0.3; see `seaStateFactor`. */
    coefficient?: number;
    /**
     * Most speed the sea is allowed to take, as a fraction. Default 0.6.
     *
     * The cap is not a physical claim, it is an admission: past roughly this
     * much loss the boat is not sailing its polar with a haircut, it is hove to,
     * running off, or under engine, and none of those is something this router
     * models. Capping keeps a bad forecast from producing an arithmetically
     * confident 20-day passage.
     */
    maxLossFraction?: number;
    /**
     * The wave period the coefficient above was calibrated at, in seconds.
     * Default 8 s — an ordinary wind sea. Seas shorter than this cost more and
     * longer swells cost less; see `seaStateFactor`.
     */
    referencePeriodS?: number;
    /**
     * How far the period term is allowed to move the answer, as a multiplier
     * either side of 1. Default 2 — a short steep sea may cost twice what its
     * height alone suggests, a long swell half.
     *
     * The clamp is doing real work. The period term goes as the inverse square,
     * so a 3-second chop would otherwise be charged seven times over, and a
     * 20-second swell written off almost entirely. Neither is true, and both
     * happen in real forecasts.
     */
    periodFactorLimit?: number;
}
/**
 * How much of its polar speed a boat keeps in a given sea.
 *
 * Added resistance in waves rises roughly with the square of wave height and
 * falls with the length of the boat, which gives the shape used here:
 *
 *     loss = coefficient · Hs² · angleFactor / referenceLength
 *
 * With the defaults, a 12 m boat punching into it loses about 3% of its speed
 * in a 1 m sea, 10% in 2 m, 22% in 3 m and 40% in 4 m. Those are the right
 * order of magnitude for a cruising boat and they are not this boat's numbers.
 * Nothing here is measured: not the coefficient, not the angle shape, and not
 * the boat. It is a defensible curve standing in for a sea trial nobody ran,
 * and every route computed with it says so in its warnings.
 *
 * The angle factor is full strength dead on the bow, falls away through the
 * beam, and keeps a small floor dead astern — a following sea still costs a
 * cruising boat something in steering and rolling, even when it is not the
 * wall a head sea is. It deliberately never goes negative: a boat that surfs
 * down a swell is a real effect and modelling it as free speed is how a router
 * talks a crew into a passage it should not make.
 *
 * Wave period IS in this, as of 2026-08, and it was the largest error here
 * before it was. Two seas of the same height are not the same sea: at a fixed
 * height a shorter period means a shorter wavelength and a steeper face, and
 * steepness is what actually stops a boat. Wave steepness goes as H/L and deep
 * -water wavelength as L = 1.56·T², so at a fixed height the period term goes
 * as the inverse square — normalised so an ordinary 8-second wind sea leaves
 * the calibration above exactly where it was, and clamped hard either side.
 *
 * Concretely, for a 2 m sea on the bow: about 20% of speed gone at 5 seconds,
 * 10% at 8, and 5% at 12. Any sailor who has beaten into short harbour chop
 * and then into an ocean swell of the same height will recognise which is
 * which, and that recognition is the only calibration this term has.
 *
 * It is the ABSOLUTE wave period, not the period the boat encounters. The
 * encounter period depends on boat speed, boat speed depends on this factor,
 * and closing that loop for a term this rough would buy precision the inputs
 * cannot support. `passageSummary.ts` computes the encounter period properly,
 * where nothing depends on the answer.
 *
 * A forecast with no period falls back to the height-and-angle answer this
 * gave before, unchanged.
 */
export declare function seaStateFactor(heightM: number, waveAngleDeg: number, periodS?: number | null, options?: SeaStateOptions): number;
export interface MotoringOptions {
    /** Speed under power in flat water, knots. */
    speedKts: number;
    /**
     * Sail slower than this and the engine goes on, in knots. Default 3 — near
     * enough to where a cruising boat stops making useful progress and the sails
     * start slatting.
     */
    thresholdKts?: number;
    /**
     * Hours of engine the boat has fuel for.
     *
     * Required, and the whole reason motoring can be modelled honestly at all.
     * An engine with unlimited fuel turns every passage into a straight line at
     * hull speed, which is not a passage plan, it is a lie with an ETA on it.
     * Fuel is what makes the engine a resource the search has to spend.
     */
    enduranceHours: number;
    /** Litres per hour, carried only so the result can report fuel burned. */
    fuelLitresPerHour?: number | null;
}
export interface RouteLeg {
    lat: number;
    lon: number;
    /** ISO time of arrival at this point. */
    time: string;
    headingDeg: number;
    twaDeg: number;
    twsKts: number;
    /** Gust speed here, where the model gave one. */
    gustKts: number | null;
    boatSpeedKts: number;
    distanceNm: number;
    /** True where the boat changes tack or gybe relative to the previous leg. */
    manoeuvre: 'tack' | 'gybe' | null;
    /** Significant wave height here, in metres, or null where no sea state was known. */
    waveHeightM: number | null;
    /** Angle the sea meets the boat at: 0 dead on the bow, 180 dead astern. */
    waveAngleDeg: number | null;
    /** Mean wave period in seconds, where the model gave one. */
    wavePeriodS: number | null;
    /** True where this leg was run under power rather than sail. */
    motoring: boolean;
}
export interface RouteResult {
    reachedDestination: boolean;
    legs: RouteLeg[];
    /** Sailing time from departure to arrival, in hours. */
    etaHours: number;
    /** Distance actually sailed. */
    distanceNm: number;
    /** Great-circle distance, for comparison. */
    directDistanceNm: number;
    warnings: string[];
    polarName: string;
    /**
     * Worst significant wave height anywhere on the route, in metres, or null
     * if the passage was sailed with no sea state at all. This is the number a
     * departure comparison is actually choosing between: two departures a day
     * apart often arrive within an hour of each other through very different
     * water.
     */
    maxWaveHeightM: number | null;
    /** Hours run under power, or null when the engine was not offered. */
    motoringHours: number | null;
    /** Litres burned, where a burn rate was given. */
    fuelLitres: number | null;
}
export interface RouteOptions {
    start: {
        lat: number;
        lon: number;
    };
    destination: {
        lat: number;
        lon: number;
    };
    /** Departure time, epoch ms. */
    departure: number;
    polar: PolarDiagram;
    wind: WindSampler;
    /** Simulation step. Shorter is more accurate and slower. Default 60. */
    stepMinutes?: number;
    /** Headings tried from each point. Default 10°. */
    headingResolutionDeg?: number;
    /** Give up after this long. Default 240 (ten days). */
    maxHours?: number;
    /** Frontier pruning resolution: one survivor per bearing bin. Default 2°. */
    sectorWidthDeg?: number;
    /**
     * Time cost charged for each tack or gybe. Without one the search gybes
     * every step to chase a fractionally better angle, producing a route no crew
     * would sail. Default 2 minutes, about right for a cruising boat with a
     * short-handed watch. Set 0 for a paper-optimal route.
     */
    manoeuvrePenaltyMinutes?: number;
    /**
     * Ignore headings more than this far off the bearing to the destination.
     * Wide enough for upwind tacking; narrow enough to stop the search sailing
     * away from where it is going. Default 110°.
     */
    maxOffCourseDeg?: number;
    /**
     * Polygons the route may not cross: the coastline, and any zone the skipper
     * has put off limits. A leg that would cross one is discarded during the
     * search rather than trimmed afterwards, so the boat sails around an
     * obstruction the way it actually would instead of being handed a route
     * with a corner cut off it.
     *
     * Clearing these polygons is NOT navigational safety — see obstacles.ts.
     * The warnings this returns keep saying so.
     */
    obstacles?: ObstacleField;
    /**
     * Sea state over the passage. Optional, and an extra rather than a
     * dependency: with no sampler, or where the sampler has no data, the search
     * is exactly the wind-only one it was before waves existed. A route is
     * better late than not planned because the marine endpoint was down.
     */
    waves?: WaveSampler;
    /**
     * Significant wave height the boat will not sail in, in metres.
     *
     * Positions in seas above this are dropped from the search, so the frontier
     * flows around a rough patch the way it flows around an obstacle rather than
     * charging through it. Off by default.
     *
     * The check is at each simulated position, not continuously along the leg,
     * so a rough patch narrower than one step can be stepped clean over. At the
     * default hour-long step that is tens of miles of sea — this keeps a route
     * out of a gale, it does not guarantee every mile of it is under the limit.
     */
    maxWaveHeightM?: number;
    /** How the sea is turned into lost speed. See `seaStateFactor`. */
    seaState?: SeaStateOptions;
    /**
     * The engine, if the boat is willing to use it.
     *
     * Off by default, and that default is not laziness: a delivery skipper and a
     * cruiser on passage are answering different questions, and a plan that
     * silently motored through every calm would flatter one of them badly. Given
     * this, the search treats the engine as a resource with a bottom to it — it
     * burns endurance, and a boat out of fuel is a sailing boat again.
     */
    motoring?: MotoringOptions;
}
/**
 * Compute a weather-optimal route.
 *
 * Returns the best route found even when the destination is not reached — a
 * frontier that stalls in a calm or runs past `maxHours` still says something
 * useful about the passage, and `reachedDestination` reports which happened.
 */
export declare function routeIsochrone(options: RouteOptions): RouteResult;
