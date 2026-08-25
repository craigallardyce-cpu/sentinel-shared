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
export interface CurrentSample {
    speedKts: number;
    /** The SET: the direction the water is going TO, in degrees true. */
    setDeg: number;
}
/** Current at a place and moment, or null where the model does not reach. */
export type CurrentSampler = (lat: number, lon: number, timeMs: number) => CurrentSample | null;
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
/** One position on a front: reachable at that time, and whether it is clear. */
export interface FrontPoint {
    lat: number;
    lon: number;
    /**
     * False where the sea at this position and hour is above the limit set.
     *
     * The whole point of retaining fronts. A front is everywhere the boat could
     * be at a given hour; subtracting the water it must not be in leaves the
     * water it can, which is what the corridor draws. Always true when no sea
     * limit was given — nothing was excluded, so nothing is marked.
     */
    clear: boolean;
}
/**
 * Everywhere the boat could be at one moment.
 *
 * The isochrone builds these to advance and has always thrown them away,
 * keeping one node per front for the route. They are the raw material of the
 * advisory corridor: not a line with a width painted on it, but the actual set
 * of places this boat can reach by that hour.
 */
export interface RouteFront {
    timeMs: number;
    /** Hours since departure, for labelling. */
    hoursFromDeparture: number;
    points: FrontPoint[];
}
export interface RouteLeg {
    lat: number;
    lon: number;
    /** ISO time of arrival at this point. */
    time: string;
    headingDeg: number;
    twaDeg: number;
    twsKts: number;
    /**
     * The direction the wind is coming FROM, degrees true.
     *
     * A leg carried the angle between the wind and the boat but not the wind
     * itself, which made it impossible to say which way the wind was blowing
     * without re-sampling the field — `twaDeg` is folded into 0-180, so the side
     * is gone. Anything drawing wind on a chart needs this.
     */
    windFromDeg: number;
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
    /** Current here, in knots, or null where none was known. */
    currentKts: number | null;
    /** The set: where the current is going, degrees true. */
    currentSetDeg: number | null;
    /** Speed over the ground, which differs from boat speed wherever there is current. */
    groundSpeedKts: number;
    /**
     * True where a real wind blows against a real current.
     *
     * Wind over tide is where an ordinary sea turns into a dangerous one: the
     * waves stand up, shorten and break, and a forecast wave height on its own
     * says none of that. It takes both to be worth naming, which is why this is
     * a flag rather than two numbers a reader is left to combine.
     */
    windAgainstCurrent: boolean;
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
    /** Strongest current met anywhere on the route, or null if none was known. */
    maxCurrentKts: number | null;
    /**
     * The reachable set at each step, when `retainFronts` asked for it.
     *
     * Empty otherwise, because holding a few hundred positions per hour for ten
     * simulated days is real memory and the passage planner has no use for it.
     */
    fronts: RouteFront[];
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
     * What a sail change costs in the dark, on top of the ordinary penalty.
     *
     * The whole of "manoeuvre limits by watch". A gybe at noon with everyone up
     * is a manoeuvre; the same gybe at 0300 short-handed means waking the
     * off-watch, working a foredeck by torchlight, and a loaded boom nobody can
     * see coming. Crews have policies about this, and a router that plans a
     * midnight gybe to save four minutes is planning a passage nobody sails.
     *
     * Each is minutes, or `Infinity` to refuse the manoeuvre outright. Tacks and
     * gybes are separate because the risk is not: a tack is a controlled stall
     * through the wind, a gybe is the boom coming across.
     *
     * MEASURED BEHAVIOUR, WORTH KNOWING BEFORE CHOOSING BETWEEN THEM. A finite
     * penalty is a bias, not a guarantee. It biases each local choice correctly,
     * but the search optimises arrival time and the frontier prunes on reach, so
     * a different penalty can select a wholly different path whose manoeuvres
     * happen to land differently. Swept over one synthetic passage, the count of
     * night manoeuvres was NOT monotonic in the penalty: 0 min gave two, 60 gave
     * one, and 90 gave four. Only `Infinity` is deterministic, which is why the
     * app offers the rule rather than the dial.
     *
     * A prohibition cannot usually strand the search, because holding the
     * current tack is never a manoeuvre and is therefore never forbidden. It can
     * where a big wind shift puts every heading inside `maxOffCourseDeg` on the
     * other side of the wind, and that case gets its own message rather than
     * being reported as a calm.
     *
     * Both default to 0, so with no policy this behaves exactly as before.
     */
    nightManoeuvre?: {
        tackPenaltyMinutes?: number;
        gybePenaltyMinutes?: number;
    };
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
     * Keep the reachable set at each step instead of discarding it.
     *
     * Off by default: the fronts are hundreds of positions per simulated hour,
     * and a departure comparison that routes six times has no use for six copies
     * of them. Underway routing does — see `corridor.ts`.
     */
    retainFronts?: boolean;
    /**
     * Sample every Nth front when retaining. Default 1 (all of them).
     *
     * A corridor drawn at hourly resolution is finer than the forecast that
     * produced it and costs proportionally more to hold and to draw. Six is a
     * sensible figure for a multi-day passage: a band every six hours.
     */
    frontIntervalSteps?: number;
    /**
     * Ocean current over the passage. Optional, like the sea.
     *
     * Unlike the wave penalty this is not an approximation of anything: it is
     * vector arithmetic. The boat sails through water, the water moves over the
     * ground, and the track is the sum of the two. That makes it the most
     * trustworthy physics in this file — all the uncertainty lives in the
     * current model, none of it in what the router does with it.
     *
     * It also changes the wind the sails feel, which is a correction people
     * forget: a boat is a body in the water, so the wind that drives it is the
     * wind relative to the water, not the wind relative to the ground the
     * forecast is referenced to.
     */
    currents?: CurrentSampler;
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
