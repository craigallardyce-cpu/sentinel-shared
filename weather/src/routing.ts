import { boatSpeed, foldTwa, type PolarDiagram } from './polars.js';
import type { ObstacleField } from './obstacles.js';
import { isNightAt } from './sun.js';

/**
 * Isochrone weather routing.
 *
 * The method is the standard one: from every point reachable at time T, try
 * every heading, advance each by the boat speed its polar gives in the wind
 * there, and keep the outermost results as the frontier for T+Δt. Repeating
 * that traces expanding fronts of equal sailing time, and the first front to
 * reach the destination carries the fastest route back through its parents.
 *
 * Two deliberate boundaries, both from the fleet's decision not to license
 * navigation cartography:
 *
 *   - LAND AVOIDANCE IS COARSE, AND OPTIONAL. Given an `obstacles` field the
 *     search discards any leg that crosses it, so a route will not run over
 *     the coastline outline or a zone the skipper has marked. Without one it
 *     knows nothing of the coast at all. Neither case is navigational safety:
 *     the outline carries no depths, rocks, reefs, buoyage or traffic
 *     schemes. Every result says which case it was in `warnings`, and callers
 *     must present it as a weather plan to lay over a chart, never as a
 *     course to steer.
 *   - Currents ARE used, as of 2026-08, and honestly: the ground track is the
 *     water track plus the current, and the wind fed to the polar is the wind
 *     relative to the moving water. The arithmetic is exact; the ocean-scale
 *     model behind it knows nothing of tidal gates or headland races, which is
 *     what the warnings say. No leeway. Sea state is used, but coarsely: wave height,
 *     the angle it meets the boat at and its period slow the polar down, and
 *     a wave height limit steers the search around water rougher than the
 *     skipper is willing to sail. Both are approximations of a boat nobody
 *     measured in a seaway — see `seaStateFactor` — and both are optional:
 *     with no `waves` sampler this behaves exactly as it did when it was
 *     wind-only.
 *   - The engine is off unless asked for, and when asked for it is a resource
 *     with a bottom to it rather than an escape from sailing. It rescues a
 *     calm; it does not shorten a beat, and it runs out of fuel. See
 *     `MotoringOptions` and the `engineOn` decision in the search.
 *
 * It runs client-side on cached forecast data, so a passage can be re-planned
 * at sea with no connectivity and costs nothing per user to compute.
 */

const EARTH_RADIUS_NM = 3440.065;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Great-circle helpers are kept local rather than imported from
// @sentinel/marine: no shared package depends on another today, and three small
// functions are not worth being the first to break that.

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial great-circle bearing in degrees. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** The point reached by steering a bearing for a distance. */
export function destinationPoint(
  lat: number,
  lon: number,
  bearing: number,
  distNm: number
): { lat: number; lon: number } {
  const angular = distNm / EARTH_RADIUS_NM;
  const brg = toRad(bearing);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brg)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
  // Keep longitude in -180..180 so a route across the antimeridian stays sane.
  return { lat: toDeg(lat2), lon: (((toDeg(lon2) + 540) % 360) - 180) };
}

/** Smallest angle between two bearings, 0-180. */
export function angleBetween(a: number, b: number): number {
  return foldTwa(a - b);
}

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

/**
 * Wind, waves and the boat live in the meteorological convention (direction
 * FROM); currents live in the marine one (set, the direction TO). Both are
 * right in their own worlds, and mixing them silently inverts a passage — so
 * every conversion between them goes through these two helpers rather than an
 * inline sign somebody has to remember to flip.
 */
function towardVector(speedKts: number, towardDeg: number): { u: number; v: number } {
  const rad = toRad(towardDeg);
  return { u: speedKts * Math.sin(rad), v: speedKts * Math.cos(rad) };
}

function vectorToward(u: number, v: number): { speedKts: number; towardDeg: number } {
  return { speedKts: Math.hypot(u, v), towardDeg: (toDeg(Math.atan2(u, v)) + 360) % 360 };
}

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
export function seaStateFactor(
  heightM: number,
  waveAngleDeg: number,
  periodS: number | null = null,
  options: SeaStateOptions = {}
): number {
  const {
    referenceLengthM = 12,
    coefficient = 0.3,
    maxLossFraction = 0.6,
    referencePeriodS = 8,
    periodFactorLimit = 2
  } = options;
  if (!Number.isFinite(heightM) || heightM <= 0) return 1;
  if (!(referenceLengthM > 0)) return 1;

  const angle = foldTwa(waveAngleDeg);
  const head = (1 + Math.cos(toRad(angle))) / 2; // 1 dead ahead, 0 dead astern
  const angleFactor = 0.1 + 0.9 * head ** 1.5;

  let periodFactor = 1;
  if (periodS !== null && Number.isFinite(periodS) && periodS > 0 && referencePeriodS > 0) {
    const raw = (referencePeriodS / periodS) ** 2;
    periodFactor = Math.min(periodFactorLimit, Math.max(1 / periodFactorLimit, raw));
  }

  const loss = (coefficient * heightM * heightM * angleFactor * periodFactor) / referenceLengthM;
  return 1 - Math.min(maxLossFraction, Math.max(0, loss));
}

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

/**
 * How the vessel is driven, which decides what "routing" even means here.
 *
 * Under sail the search is looking FOR wind: the polar is the boat's whole
 * performance, a calm is a disaster, and the crossings of the wind a route
 * implies — tacks and gybes — are work somebody has to do on deck at whatever
 * hour they fall.
 *
 * Under power it is looking to AVOID weather: the polar is a throttle setting
 * the wind and sea can only take away from, a calm is the best day of the
 * passage, and crossing the wind means nothing at all because there is
 * nothing to sheet in. What replaces the manoeuvre bookkeeping is fuel, and it
 * is a harder constraint than any of it — a sailing boat out of fuel is a
 * sailing boat, and a motorboat out of fuel is adrift.
 *
 * Defaults to sail, so every existing caller behaves exactly as it did.
 */
export type Propulsion = 'sail' | 'power';

/**
 * The tank, when the engine is the only thing moving the vessel.
 *
 * Not `MotoringOptions`. That describes a sailing boat's auxiliary — an engine
 * switched on when the sails give up, whose speed is a separate number from
 * the polar's, and whose running out means falling back on sail. None of those
 * is true here: the polar IS the engine, it runs the whole passage, and
 * running out ends it. Sharing one type between the two would mean every
 * reader of it first having to work out which kind of vessel they were
 * looking at.
 */
export interface FuelOptions {
  /** Litres per hour at the modelled throttle setting. */
  litresPerHour: number;
  /**
   * Litres this passage may actually spend — the tank LESS its reserve.
   *
   * The subtraction happens before this is handed over, deliberately: the
   * router should never be in a position to plan the reserve away, and one
   * number it must not exceed is harder to get wrong than a capacity plus a
   * percentage it has to remember to combine.
   */
  usableLitres: number;
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
  /**
   * How the vessel this route was computed for is driven.
   *
   * Carried out rather than left for the caller to remember, because almost
   * everything downstream reads differently depending on it: "3 manoeuvres"
   * is meaningless under power, "12 hours motoring" is the whole passage
   * rather than a rescue, and a calm is good news instead of bad.
   */
  propulsion: Propulsion;
  /** Hours run under power, or null when the engine was not offered. */
  motoringHours: number | null;
  /** Litres burned, where a burn rate was given. */
  fuelLitres: number | null;
  /**
   * Litres the passage was allowed to spend — the tank less its reserve —
   * under power. Null under sail, where the tank is stated in hours instead.
   *
   * Reported so a result can say "268 of 380 litres" rather than leaving a
   * burn figure with nothing to be a fraction of.
   */
  usableFuelLitres: number | null;
  /**
   * True where the search was stopped by the tank rather than by the clock,
   * the coast or the sea.
   *
   * A distinct outcome and not a detail. Every other reason a route falls
   * short is about the weather and is answered by choosing another departure;
   * this one is about the vessel, and no departure fixes it. It means the
   * passage as asked for is beyond this vessel's range, and the honest
   * response is more fuel, a stop on the way, or a shorter passage.
   */
  ranOutOfFuel: boolean;
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
  start: { lat: number; lon: number };
  destination: { lat: number; lon: number };
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
   *
   * Ignored under power, where the engine is not an option the search takes
   * but the thing moving the vessel. Use `fuel` for that.
   */
  motoring?: MotoringOptions;
  /**
   * Sail or power. Default sail.
   *
   * Under power the search changes in four ways, all of them consequences of
   * there being no sails rather than settings:
   *
   *   - The polar is a throttle setting. Build it with `powerPolar`, which
   *     charges windage against it; the sea is charged on top by the same
   *     `seaState` path a sailing boat uses, with `powerSeaState` supplying
   *     the coefficients.
   *   - A calm is not a stall. The search does not give up on a position with
   *     no forecast wind, because no wind is exactly the weather a motorboat
   *     wants.
   *   - Tacks and gybes do not exist. Manoeuvre penalties and the night watch
   *     policy are both ignored, and legs come back with `manoeuvre: null` —
   *     charging a motorboat two minutes for crossing the wind, or refusing to
   *     let it do so at 0300, would be inventing work nobody does.
   *   - Fuel is a wall, not a budget. See `fuel`.
   */
  propulsion?: Propulsion;
  /**
   * The tank, under power. Required to bound the passage; without it the
   * search will happily route a vessel a thousand miles past empty.
   *
   * Unlike the sailing boat's `motoring`, running out here does not change how
   * the vessel moves — it stops it. So the frontier simply ends where the fuel
   * does: the route comes back short, `ranOutOfFuel` says why, and the
   * warnings say how far it got. That is the truthful answer to "can this
   * vessel make this passage", and it is one only a hard limit can give.
   */
  fuel?: FuelOptions;
}

interface Node {
  lat: number;
  lon: number;
  timeMs: number;
  parent: Node | null;
  headingDeg: number;
  twaDeg: number;
  twsKts: number;
  windFromDeg: number;
  gustKts: number | null;
  boatSpeedKts: number;
  distanceNm: number;
  /** Sign of the wind angle: -1 port, +1 starboard, 0 head/dead down. */
  tackSide: number;
  waveHeightM: number | null;
  waveAngleDeg: number | null;
  wavePeriodS: number | null;
  motoring: boolean;
  /** Engine hours used getting here, so fuel is spent along a route not per leg. */
  motorHours: number;
  currentKts: number | null;
  currentSetDeg: number | null;
  groundSpeedKts: number;
  windAgainstCurrent: boolean;
}

/**
 * What counts as wind over tide.
 *
 * Both sides have to be real. A knot of current under a gale is not what
 * stands a sea up, and neither is four knots of stream in a flat calm — the
 * effect needs the wind to be building waves and the water to be running the
 * other way. The angle is a proper opposition rather than any crossing:
 * anything inside 120 degrees is a current that shortens the fetch a bit, not
 * one that turns a swell into breakers.
 */
const WIND_OVER_TIDE_CURRENT_KTS = 1;
const WIND_OVER_TIDE_WIND_KTS = 12;
const WIND_OVER_TIDE_ANGLE_DEG = 120;

/**
 * "sailing it" or "running it".
 *
 * A small word, and not a cosmetic one. A motorboat owner told to check the
 * chart "before sailing it" is being handed a warning written for somebody
 * else, and the first thing that costs is their belief that the rest of the
 * sentence was written for them either.
 */
const verb = (propulsion: Propulsion) => (propulsion === 'power' ? 'running' : 'sailing');

const noLandWarning = (propulsion: Propulsion) =>
  `This route is computed from wind and the vessel's performance model only. It does not know ` +
  'where land, shallows, or traffic schemes are — check every leg against your chart before ' +
  `${verb(propulsion)} it.`;

/**
 * Used instead when an obstacle field is supplied.
 *
 * The wording is deliberate and should not be softened. Steering around the
 * coastline outline is a coarse, shape-level check: it says the route does not
 * run overland, and says nothing whatever about whether the water it does run
 * through is deep enough or clear. A skipper who reads "avoids land" as
 * "checked" is in more danger than one who knows nothing was checked at all,
 * which is why the sentence leads with what is still unknown.
 */
const coarseLandWarning = (propulsion: Propulsion) =>
  'This route was kept clear of the coastline outline and any zones you have marked, but that is ' +
  'a check against a coarse outline of the shape of the land — it knows nothing of depths, rocks, ' +
  'reefs, buoyage or traffic schemes, and a strait it leaves open may not be. Check every leg ' +
  `against your chart before ${verb(propulsion)} it.`;

/**
 * What using sea state does, and does not, entitle a route to claim.
 *
 * Appended at the end rather than led with, because unlike the land warning it
 * is not the thing most likely to hurt someone — but it is not optional
 * either. A boat given a wave-aware ETA will trust it further than a wind-only
 * one, and the extra trust is not earned by anything measured.
 *
 * The no-data case gets its own sentence for the same reason a calm and a
 * headwind do: a plan that quietly fell back to wind-only, in exactly the
 * coastal or high-latitude corners where the marine models thin out, is one a
 * skipper would otherwise read as having been checked against the sea.
 */
function seaStateWarnings(
  waves: WaveSampler | undefined,
  sampleCount: number,
  seaLimit: number | null
): string[] {
  if (!waves) return [];
  if (sampleCount === 0) {
    return [
      'No sea state covered this passage, so these timings are from wind and polar alone. The ' +
        'marine forecast reaches neither as far ahead nor as far into coastal water as the wind ' +
        'one does, and where it stops this route knows nothing about the sea it is crossing.'
    ];
  }
  const notes = [
    'Sea state is charged against the boat as a coarse speed penalty from wave height, the angle ' +
      'it meets the boat at, and — where the forecast carries a period — the steepness those two ' +
      'imply, so a short sea costs more than a long swell of the same height. It is a reasonable ' +
      'curve for a cruising boat, not this boat measured in a seaway: neither the coefficient, nor ' +
      'the angle shape, nor the steepness term came from anything sailed. Treat a rough-weather ' +
      'ETA as the optimistic end.'
  ];
  if (seaLimit !== null) {
    notes.push(
      `The route was kept out of seas above ${seaLimit} m, checked at each simulated position ` +
        'rather than continuously — a patch of rougher water narrower than one step of the search ' +
        'can be stepped straight over. It keeps a passage out of a gale; it does not promise every ' +
        'mile of it is under the limit.'
    );
  }
  return notes;
}

/**
 * What a routed engine is and is not promising.
 *
 * The endurance warning is the one that matters. A route that spends its last
 * litre of diesel three days from anywhere has been planned, arithmetically,
 * to arrive with nothing in reserve — and a passage plan that quietly assumes
 * a dry tank at landfall is worse than one that never offered the engine.
 */
function motoringWarnings(motoring: MotoringOptions | undefined, legs: RouteLeg[]): string[] {
  if (!motoring) return [];
  const { motoringHours } = engineUse(legs, motoring);
  if (motoringHours === null || motoringHours <= 0) return [];

  const notes = [
    `Engine hours are planned at a flat ${motoring.speedKts} knots, slowed by the sea the way the ` +
      'sails are. Real motoring is not flat: it depends on how loaded the boat is, how foul the ' +
      'bottom is and how hard the skipper is willing to push, none of which is known here.'
  ];
  if (motoringHours / motoring.enduranceHours > 0.8) {
    notes.push(
      `This route plans ${motoringHours.toFixed(0)} of the ${motoring.enduranceHours.toFixed(0)} ` +
        'engine hours the boat has fuel for, so it arrives with next to nothing in the tank. Plan ' +
        'against a reserve you would be content to make harbour on, not against the whole tank.'
    );
  }
  return notes;
}

/**
 * What a current-aware route is and is not claiming.
 *
 * The arithmetic here is the one honest piece of physics in this file — a
 * boat's track really is its water track plus the current, with no fitted
 * coefficient anywhere. So the warning is not about the method. It is about
 * the model underneath it, which resolves an ocean at a scale that misses
 * every tidal gate, headland race and eddy a coastal passage actually turns
 * on, and which is the part a skipper might otherwise take on trust.
 */
function currentWarnings(
  currents: CurrentSampler | undefined,
  sampleCount: number,
  legs: RouteLeg[]
): string[] {
  if (!currents) return [];
  if (sampleCount === 0) {
    return [
      'No current data covered this passage, so the track is through the water only. Where a ' +
        'stream runs, the ground track and the timings will both be out.'
    ];
  }
  const notes = [
    'Currents come from an ocean-scale model. It carries the great streams — the Gulf Stream, the ' +
      'Kuroshio, the Agulhas — and it knows nothing whatever of tidal gates, headland races, ' +
      'overfalls or the set inside a bay. Near a coast, the tide in your almanac beats this.'
  ];
  if (legs.some((l) => l.windAgainstCurrent)) {
    notes.push(
      'Part of this route has the wind blowing against the current. That is where a sea stands up, ' +
        'shortens and breaks, and the forecast wave height above does not know it is happening — ' +
        'the real water there will be worse than the number says.'
    );
  }
  return notes;
}

/**
 * Said when a watch policy shaped the route, because it means the route is
 * deliberately not the fastest one available and a reader comparing ETAs
 * deserves to know which thumb is on the scale.
 */
function watchWarnings(
  nightManoeuvre: RouteOptions['nightManoeuvre'],
  legs: RouteLeg[]
): string[] {
  if (!nightManoeuvre) return [];
  const tack = nightManoeuvre.tackPenaltyMinutes ?? 0;
  const gybe = nightManoeuvre.gybePenaltyMinutes ?? 0;
  if (tack <= 0 && gybe <= 0) return [];

  // Counted at the START of each leg, where the boat actually turns and where
  // the search charged for it. A leg carries its arrival time, so counting on
  // that would report a dusk gybe as a night one.
  const nightWork = legs.filter(
    (l, i) => l.manoeuvre && i > 0 && isNightAt(l.lat, l.lon, Date.parse(legs[i - 1].time))
  ).length;

  const refused = !Number.isFinite(tack) || !Number.isFinite(gybe);
  const note = refused
    ? 'This route was planned not to change sail in the dark, so it is not the fastest passage ' +
      'available — it is the fastest one that leaves the off-watch asleep.'
    : 'Sail changes in darkness were charged against this route, so it is not the fastest passage ' +
      'available. A charge is a preference rather than a rule: it biases each choice, but the ' +
      'search is still optimising arrival time, and a route can come back with more night work ' +
      'than an unconstrained one. Set the policy to refuse them if it matters.';

  return [
    nightWork === 0
      ? `${note} Nothing in it falls at night.`
      : `${note} ${nightWork} sail ${nightWork === 1 ? 'change' : 'changes'} still ${nightWork === 1 ? 'falls' : 'fall'} in darkness.`
  ];
}

function relativeSide(headingDeg: number, windFromDeg: number): number {
  const delta = ((headingDeg - windFromDeg + 540) % 360) - 180;
  if (Math.abs(delta) < 1e-6 || Math.abs(Math.abs(delta) - 180) < 1e-6) return 0;
  return delta > 0 ? 1 : -1;
}

function buildLegs(node: Node, polarName: string, propulsion: Propulsion = 'sail'): RouteLeg[] {
  const chain: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) chain.push(n);
  chain.reverse();

  const legs: RouteLeg[] = [];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    const prev = i > 0 ? chain[i - 1] : null;
    let manoeuvre: 'tack' | 'gybe' | null = null;
    // A motorboat crossing the wind has done nothing. Leaving the sailing
    // test to run would have every alteration of course through the wind line
    // reported as a tack, and a night-time one counted as work the off-watch
    // was woken for — a passage summary describing a boat that is not there.
    if (propulsion !== 'power' && prev && prev.tackSide !== 0 && n.tackSide !== 0 && prev.tackSide !== n.tackSide) {
      // Crossing the wind forward of the beam is a tack, behind it a gybe.
      manoeuvre = (prev.twaDeg + n.twaDeg) / 2 < 90 ? 'tack' : 'gybe';
    }
    legs.push({
      lat: n.lat,
      lon: n.lon,
      time: new Date(n.timeMs).toISOString(),
      headingDeg: Math.round(n.headingDeg * 10) / 10,
      twaDeg: Math.round(n.twaDeg * 10) / 10,
      twsKts: Math.round(n.twsKts * 10) / 10,
      windFromDeg: Math.round(n.windFromDeg),
      gustKts: n.gustKts === null ? null : Math.round(n.gustKts * 10) / 10,
      boatSpeedKts: Math.round(n.boatSpeedKts * 100) / 100,
      distanceNm: Math.round(n.distanceNm * 100) / 100,
      manoeuvre,
      waveHeightM: n.waveHeightM === null ? null : Math.round(n.waveHeightM * 10) / 10,
      waveAngleDeg: n.waveAngleDeg === null ? null : Math.round(n.waveAngleDeg),
      wavePeriodS: n.wavePeriodS === null ? null : Math.round(n.wavePeriodS),
      motoring: n.motoring,
      currentKts: n.currentKts === null ? null : Math.round(n.currentKts * 100) / 100,
      currentSetDeg: n.currentSetDeg === null ? null : Math.round(n.currentSetDeg),
      groundSpeedKts: Math.round(n.groundSpeedKts * 100) / 100,
      windAgainstCurrent: n.windAgainstCurrent
    });
  }
  return legs;
}

function totalDistance(legs: RouteLeg[]): number {
  return Math.round(legs.reduce((sum, l) => sum + l.distanceNm, 0) * 100) / 100;
}

/**
 * The roughest water the route goes through, rounded as the legs are.
 *
 * Taken from the legs rather than tracked during the search, so it describes
 * the passage that was actually chosen and not the worst sea the frontier
 * looked at and rejected.
 */
function engineUse(
  legs: RouteLeg[],
  motoring: MotoringOptions | undefined
): { motoringHours: number | null; fuelLitres: number | null } {
  if (!motoring) return { motoringHours: null, fuelLitres: null };
  let hours = 0;
  for (let i = 1; i < legs.length; i++) {
    if (!legs[i].motoring) continue;
    hours += (Date.parse(legs[i].time) - Date.parse(legs[i - 1].time)) / 3_600_000;
  }
  const burn = motoring.fuelLitresPerHour;
  return {
    motoringHours: Math.round(hours * 100) / 100,
    fuelLitres:
      burn !== null && burn !== undefined && Number.isFinite(burn)
        ? Math.round(hours * burn * 10) / 10
        : null
  };
}

/**
 * The engine block of the result, for either kind of vessel.
 *
 * Under sail this is `engineUse` unchanged: hours are counted only over the
 * legs the search chose to motor, and there is no litre figure unless a burn
 * rate was given.
 *
 * Under power the counting is different in a way worth being explicit about.
 * The engine ran for the whole passage — every leg is a motoring leg — so the
 * hours are simply the elapsed time, and the fuel follows from the burn rate
 * rather than from any per-leg decision. That is also why weather costs a
 * motorboat fuel: a head sea does not reduce the burn, it lengthens the
 * passage the burn is multiplied by.
 */
function propulsionReport(
  legs: RouteLeg[],
  propulsion: Propulsion,
  motoring: MotoringOptions | undefined,
  fuel: FuelOptions | undefined,
  ranOutOfFuel: boolean
): Pick<
  RouteResult,
  'propulsion' | 'motoringHours' | 'fuelLitres' | 'usableFuelLitres' | 'ranOutOfFuel'
> {
  if (propulsion !== 'power') {
    return {
      propulsion,
      ...engineUse(legs, motoring),
      usableFuelLitres: null,
      ranOutOfFuel: false
    };
  }
  const first = legs[0];
  const last = legs[legs.length - 1];
  const hours =
    first && last ? Math.max(0, (Date.parse(last.time) - Date.parse(first.time)) / 3_600_000) : 0;
  const burn = fuel && Number.isFinite(fuel.litresPerHour) ? fuel.litresPerHour : null;
  return {
    propulsion,
    motoringHours: Math.round(hours * 100) / 100,
    fuelLitres: burn === null ? null : Math.round(hours * burn * 10) / 10,
    usableFuelLitres:
      fuel && Number.isFinite(fuel.usableLitres) ? Math.round(fuel.usableLitres * 10) / 10 : null,
    ranOutOfFuel
  };
}

/**
 * What a routed motorboat is and is not promising.
 *
 * Deliberately not the sailing boat's engine warning. That one is about an
 * auxiliary being used more than its owner meant; this one is about the only
 * thing moving the vessel, and the number that matters is not how much of the
 * tank the passage spends but how little is left over when it is wrong.
 */
function powerWarnings(fuel: FuelOptions | undefined, legs: RouteLeg[], ranOutOfFuel: boolean): string[] {
  const notes = [
    'This passage is planned at one throttle setting the whole way. A real skipper throttles up ' +
      'to make a window and back off when it turns nasty, and neither is modelled here — so read ' +
      'the timings as what this vessel does if nobody touches the levers.'
  ];
  if (!fuel) return notes;

  const { fuelLitres } = propulsionReport(legs, 'power', undefined, fuel, false);
  if (ranOutOfFuel) {
    notes.push(
      `This vessel runs out of usable fuel before it gets there. It is planned against ` +
        `${Math.round(fuel.usableLitres)} litres — the tank less the reserve you asked to keep — ` +
        'and no departure time fixes a passage that is simply beyond its range. The answers are ' +
        'more fuel, a stop on the way, or a shorter leg.'
    );
    return notes;
  }
  if (fuelLitres !== null && fuel.usableLitres > 0) {
    const spent = fuelLitres / fuel.usableLitres;
    if (spent > 0.8) {
      notes.push(
        `It plans ${Math.round(fuelLitres)} of the ${Math.round(fuel.usableLitres)} usable litres ` +
          'aboard, so it arrives on the reserve and nothing else. Weather that slows the vessel ' +
          'does not slow the burn — an extra day of head sea is an extra day of fuel at the same ' +
          'litres an hour, and this figure has no room in it for one.'
      );
    }
  }
  return notes;
}

function worstCurrent(legs: RouteLeg[]): number | null {
  let worst: number | null = null;
  for (const leg of legs) {
    if (leg.currentKts === null) continue;
    if (worst === null || leg.currentKts > worst) worst = leg.currentKts;
  }
  return worst;
}

function worstSeas(legs: RouteLeg[]): number | null {
  let worst: number | null = null;
  for (const leg of legs) {
    if (leg.waveHeightM === null) continue;
    if (worst === null || leg.waveHeightM > worst) worst = leg.waveHeightM;
  }
  return worst;
}

/**
 * Compute a weather-optimal route.
 *
 * Returns the best route found even when the destination is not reached — a
 * frontier that stalls in a calm or runs past `maxHours` still says something
 * useful about the passage, and `reachedDestination` reports which happened.
 */
export function routeIsochrone(options: RouteOptions): RouteResult {
  const {
    start,
    destination,
    departure,
    polar,
    wind,
    stepMinutes = 60,
    headingResolutionDeg = 10,
    maxHours = 240,
    sectorWidthDeg = 2,
    maxOffCourseDeg = 110,
    manoeuvrePenaltyMinutes = 2,
    nightManoeuvre,
    obstacles,
    waves,
    maxWaveHeightM,
    seaState,
    motoring,
    currents,
    retainFronts = false,
    frontIntervalSteps = 1,
    propulsion = 'sail',
    fuel
  } = options;

  const isMotorVessel = propulsion === 'power';
  /**
   * Hours the tank is good for, under power. Null when no tank was given,
   * which leaves the passage bounded only by `maxHours` — wrong, and loudly
   * warned about, but better than refusing to plan at all for somebody who has
   * not filled the field in yet.
   */
  const fuelHours =
    isMotorVessel && fuel && fuel.litresPerHour > 0 && fuel.usableLitres > 0
      ? fuel.usableLitres / fuel.litresPerHour
      : null;
  let ranOutOfFuel = false;

  // Crossing the wind is work under sail and nothing at all under power, so
  // neither the ordinary penalty nor the night watch policy applies to a
  // motorboat. Neutralised here, once, rather than tested at each of the four
  // places downstream that would otherwise have to remember.
  const manoeuvreCost = isMotorVessel ? 0 : manoeuvrePenaltyMinutes;
  const nightPolicy = isMotorVessel ? undefined : nightManoeuvre;

  const avoiding = Boolean(obstacles && obstacles.count > 0);
  const warnings: string[] = [avoiding ? coarseLandWarning(propulsion) : noLandWarning(propulsion)];
  if (polar.generic) {
    warnings.push(
      `Timings come from a generic polar (${polar.name}), not this boat's measured performance — ` +
        'treat the ETA as a comparison between departure times, not a promise.'
    );
  }

  if (polar.note) warnings.push(polar.note);

  const seaLimit = Number.isFinite(maxWaveHeightM) ? (maxWaveHeightM as number) : null;
  // Whether the sea state ever actually resolved. A sampler that was supplied
  // but had nothing for this passage must not leave the result looking like it
  // was routed through waves, so the count decides which warning is told.
  let waveSampleCount = 0;
  let currentSampleCount = 0;
  const fronts: RouteFront[] = [];

  /**
   * Record a front, marking each position clear or not.
   *
   * Called with the frontier BEFORE it is pruned to one node per sector, so
   * the corridor describes the water the boat can actually reach rather than
   * the handful of points the search kept to carry on from.
   */
  /**
   * Mark a position as not clear on whichever front it was recorded in.
   *
   * The sea limit is tested when a node is expanded, one step after the node
   * was created — so a position is discovered to be in the gale after it has
   * already been written down as reachable. This goes back and says so, which
   * is what carves the hazard out of the corridor.
   */
  const markNotClear = (node: Node) => {
    if (!retainFronts) return;
    for (let i = fronts.length - 1; i >= 0; i--) {
      if (fronts[i].timeMs !== node.timeMs) continue;
      const hit = fronts[i].points.find(
        (pt) => Math.abs(pt.lat - node.lat) < 1e-4 && Math.abs(pt.lon - node.lon) < 1e-4
      );
      if (hit) hit.clear = false;
      return;
    }
  };

  const recordFront = (step: number, nodes: Node[], timeMs: number) => {
    if (!retainFronts) return;
    if (step % Math.max(1, Math.round(frontIntervalSteps)) !== 0) return;
    if (!nodes.length) return;
    fronts.push({
      timeMs,
      hoursFromDeparture: Math.round(((timeMs - departure) / 3_600_000) * 100) / 100,
      points: nodes.map((n) => ({
        lat: Math.round(n.lat * 10000) / 10000,
        lon: Math.round(n.lon * 10000) / 10000,
        // A node only exists if the search let it through, and the sea limit
        // is applied when a node is EXPANDED rather than when it is created.
        // So a retained node is clear by construction unless its own water is
        // over the limit, which the next step will discover.
        clear: true
      }))
    });
  };

  const directDistanceNm = distanceNm(start.lat, start.lon, destination.lat, destination.lon);
  const stepHours = stepMinutes / 60;
  const maxSteps = Math.max(1, Math.floor(maxHours / stepHours));

  // Say so immediately when an end of the passage is inside an obstacle.
  //
  // Without this the search behaves badly in a way that reads as a bug: a
  // destination a few hundred metres inland is approachable but never
  // arrivable, so the frontier crowds the shore and then wanders for the whole
  // time limit — ten simulated days to say nothing. It is also the single most
  // likely mistake a user can make here, since a place name means the town and
  // towns are on land. Naming the problem is worth more than any route.
  if (avoiding) {
    const startZone = obstacles!.contains(start.lat, start.lon);
    const destZone = obstacles!.contains(destination.lat, destination.lon);
    const describe = (z: { kind: string; name?: string }) =>
      z.kind === 'land' ? 'is on land' : `is inside the zone you marked${z.name ? ` — ${z.name}` : ''}`;
    if (startZone || destZone) {
      if (startZone) warnings.push(`The starting position ${describe(startZone)}, so no passage could be started from it.`);
      if (destZone) warnings.push(`The destination ${describe(destZone)}, so no passage could reach it. Pick a position in open water — the place search offers approaches offshore of each port.`);
      return {
        reachedDestination: false,
        legs: [],
        etaHours: 0,
        distanceNm: 0,
        directDistanceNm: Math.round(directDistanceNm * 100) / 100,
        warnings,
        polarName: polar.name,
        maxWaveHeightM: null,
        propulsion,
        motoringHours: null,
        fuelLitres: null,
        usableFuelLitres: null,
        ranOutOfFuel: false,
        maxCurrentKts: null,
        fronts: []
      };
    }
  }

  const root: Node = {
    lat: start.lat,
    lon: start.lon,
    timeMs: departure,
    parent: null,
    headingDeg: bearingDeg(start.lat, start.lon, destination.lat, destination.lon),
    twaDeg: 0,
    twsKts: 0,
    windFromDeg: 0,
    gustKts: null,
    boatSpeedKts: 0,
    distanceNm: 0,
    tackSide: 0,
    waveHeightM: null,
    waveAngleDeg: null,
    wavePeriodS: null,
    motoring: false,
    motorHours: 0,
    currentKts: null,
    currentSetDeg: null,
    groundSpeedKts: 0,
    windAgainstCurrent: false
  };

  let frontier: Node[] = [root];
  let best: Node = root;
  let bestRemaining = directDistanceNm;

  for (let step = 0; step < maxSteps; step++) {
    const nextTime = departure + (step + 1) * stepMinutes * 60_000;
    const candidates: Node[] = [];
    // Why each course was discarded, so an empty step can say what actually
    // stopped it. "No wind" was the only explanation on offer, and it was
    // usually the wrong one: a boat pinned in a bay by a headwind has plenty
    // of wind and nowhere it is allowed to point.
    let blockedByLand = 0;
    let unsailable = 0;
    let noWind = 0;
    let calm = 0;
    let tooRough = 0;
    let forbiddenAtNight = 0;
    let outOfFuel = 0;

    /**
     * The tank, as a wall the frontier may not expand past.
     *
     * Applied to the expansion only, never to the arrival test: a vessel with
     * forty minutes of fuel left and half an hour to run does get there, and
     * cutting the search at the last whole step would report that passage as
     * out of range. So fuel stops the search carrying ON, and the endgame is
     * still allowed to finish inside whatever is left.
     */
    const fuelStopsExpansion =
      fuelHours !== null && (nextTime - departure) / 3_600_000 > fuelHours;

    for (const node of frontier) {
      const sample = wind(node.lat, node.lon, node.timeMs);
      if (!sample || !Number.isFinite(sample.speedKts)) { noWind++; continue; }
      // Whether the engine is an option from HERE, which is not the same as
      // whether the boat has one: fuel is spent along a route, so a node deep
      // into a passage may have burned what an earlier one still had.
      const canMotor = !isMotorVessel && Boolean(motoring) && node.motorHours < motoring!.enduranceHours;
      // A calm is not a headwind. Both leave the boat going nowhere, but only
      // one of them is fixed by waiting for a shift, so they must not share a
      // message. Neither stops a boat with fuel left — and neither stops a
      // motorboat at all, for which a flat calm is the best water it will see
      // all passage rather than a reason to give up on the position.
      if (sample.speedKts <= 0 && !canMotor && !isMotorVessel) { calm++; continue; }

      // The current here, and the wind the sails actually feel because of it.
      //
      // A boat is a body in the water, so what drives it is the wind relative
      // to the water — the forecast wind, which is referenced to the ground,
      // minus the current. In two knots of stream that is a couple of degrees
      // and a knot: small, free, and in the direction of the truth.
      const stream = currents ? currents(node.lat, node.lon, node.timeMs) : null;
      const streamVec =
        stream && Number.isFinite(stream.speedKts) && stream.speedKts > 0
          ? towardVector(stream.speedKts, stream.setDeg)
          : null;
      if (stream && Number.isFinite(stream.speedKts)) currentSampleCount++;

      let windForSails = sample;
      if (streamVec) {
        const airOverGround = towardVector(sample.speedKts, (sample.directionDeg + 180) % 360);
        const airOverWater = vectorToward(
          airOverGround.u - streamVec.u,
          airOverGround.v - streamVec.v
        );
        windForSails = {
          speedKts: airOverWater.speedKts,
          directionDeg: (airOverWater.towardDeg + 180) % 360,
          gustKts: sample.gustKts
        };
      }

      // Wind over tide: a real wind blowing against a real current. Judged on
      // the ground-referenced wind, because that is the wind the sea itself is
      // being built by.
      const windOverTide = Boolean(
        streamVec &&
          stream!.speedKts >= WIND_OVER_TIDE_CURRENT_KTS &&
          sample.speedKts >= WIND_OVER_TIDE_WIND_KTS &&
          angleBetween((sample.directionDeg + 180) % 360, stream!.setDeg) > WIND_OVER_TIDE_ANGLE_DEG
      );
      const streamOf = () => ({
        currentKts: stream && Number.isFinite(stream.speedKts) ? stream.speedKts : null,
        currentSetDeg: stream && Number.isFinite(stream.speedKts) ? stream.setDeg : null,
        windAgainstCurrent: windOverTide
      });

      // The sea here, and what the boat keeps of its polar in it. Sampled once
      // per position: the height and the direction of the sea do not depend on
      // which course is being tried, only the angle between them does.
      const sea = waves ? waves(node.lat, node.lon, node.timeMs) : null;
      if (sea && Number.isFinite(sea.heightM)) {
        waveSampleCount++;
        // Above the skipper's limit this water is simply not available, the
        // same as land. Dropping the whole position rather than each course
        // is what lets the frontier route around a gale instead of into it.
        if (seaLimit !== null && sea.heightM > seaLimit) {
          tooRough++;
          markNotClear(node);
          continue;
        }
      }
      // The sea slows a boat under power exactly as it slows one under sail —
      // more so, since a motoring boat is usually pointing straight into it
      // rather than choosing a comfortable angle.
      const inSea = (speed: number, headingDeg: number): number => {
        if (!sea || !Number.isFinite(sea.heightM) || speed <= 0) return speed;
        return (
          speed *
          seaStateFactor(
            sea.heightM,
            angleBetween(headingDeg, sea.directionDeg),
            sea.periodS,
            seaState
          )
        );
      };

      const sailedOn = (headingDeg: number, twaDeg: number) =>
        inSea(boatSpeed(polar, twaDeg, windForSails.speedKts), headingDeg);

      /**
       * Where the boat actually goes on a heading, and how fast.
       *
       * A heading is steered through the water; the ground track is that plus
       * the current. With no current the two are identical and this costs a
       * vector addition of zero.
       */
      const groundTrack = (headingDeg: number, throughWaterKts: number) => {
        if (!streamVec) return { courseDeg: headingDeg, speedKts: throughWaterKts };
        const water = towardVector(throughWaterKts, headingDeg);
        const ground = vectorToward(water.u + streamVec.u, water.v + streamVec.v);
        return { courseDeg: ground.towardDeg, speedKts: ground.speedKts };
      };

      const toDest = bearingDeg(node.lat, node.lon, destination.lat, destination.lon);

      /**
       * Whether the engine goes on here at all.
       *
       * Decided ONCE per position, from the best progress the sails could make
       * toward the destination on any heading — not per heading. That
       * distinction is the whole design, and getting it wrong the other way
       * produced a router that motored dead upwind past a fleet of boats
       * sailing: on a head-to-wind heading the sails give nothing, so a
       * per-heading test always preferred the engine, and every windward
       * passage became a motor.
       *
       * Judged on VMG rather than boat speed because that is the question a
       * skipper is actually asking. A boat beating at six knots is making
       * three good, and whether that is worth motoring for depends on the
       * three, not the six.
       *
       * The consequence is deliberate and worth stating: this engine rescues a
       * calm, it does not shorten a beat. A delivery skipper motorsailing to
       * windward is doing something real, but it is a different question from
       * the one a passage plan answers, and defaulting to it would quietly
       * turn every upwind forecast into a fuel bill.
       */
      let engineOn = false;
      if (canMotor) {
        let bestSailVmg = 0;
        for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
          const speed = sailedOn(heading, angleBetween(heading, windForSails.directionDeg));
          if (speed <= 0) continue;
          const ground = groundTrack(heading, speed);
          const vmg = ground.speedKts * Math.cos(toRad(angleBetween(ground.courseDeg, toDest)));
          if (vmg > bestSailVmg) bestSailVmg = vmg;
        }
        engineOn = bestSailVmg < (motoring!.thresholdKts ?? 3);
      }

      /** What the boat does on a heading, and whether the engine is doing it. */
      const speedIn = (headingDeg: number, twaDeg: number): { speed: number; motoring: boolean } => {
        const sailed = sailedOn(headingDeg, twaDeg);
        // Under power there is no second option to weigh: the polar already
        // IS the engine at its throttle setting, with the windage taken off
        // it, and `inSea` has taken the sea off that. Every leg is a motoring
        // leg, which is what makes the fuel arithmetic downstream simply the
        // elapsed time.
        if (isMotorVessel) return { speed: sailed, motoring: true };
        if (!engineOn) return { speed: sailed, motoring: false };
        const motored = inSea(motoring!.speedKts, headingDeg);
        // Still take the sails where they happen to beat the engine — a boat
        // that has started its engine does not drop the main.
        if (sailed >= motored) return { speed: sailed, motoring: false };
        return { speed: motored, motoring: true };
      };

      const seaOf = (headingDeg: number) => ({
        waveHeightM: sea && Number.isFinite(sea.heightM) ? sea.heightM : null,
        waveAngleDeg: sea && Number.isFinite(sea.heightM)
          ? angleBetween(headingDeg, sea.directionDeg)
          : null,
        wavePeriodS: sea?.periodS ?? null
      });

      // Whether the crew here is working in the dark. One test per position:
      // every course leaving it does so at the same moment.
      const darkHere = nightPolicy ? isNightAt(node.lat, node.lon, node.timeMs) : false;

      const toDestination = toDest;
      const remaining = distanceNm(node.lat, node.lon, destination.lat, destination.lon);

      // Final approach. Closing speed is velocity made good toward the
      // destination, not boat speed: the last miles are often dead upwind, and
      // a boat that must tack them still arrives — just later. Testing only a
      // heading that points straight at the destination would strand the search
      // a mile off a windward landfall, sailing in circles until it timed out.
      let closingVmg = 0;
      let closingHeading = toDestination;
      let closingTwa = angleBetween(toDestination, windForSails.directionDeg);
      let closingMotoring = false;
      let closingGround = 0;
      for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
        const twa = angleBetween(heading, windForSails.directionDeg);
        const { speed, motoring: underPower } = speedIn(heading, twa);
        if (speed <= 0) continue;
        const ground = groundTrack(heading, speed);
        // Closing speed is made good over the GROUND. A boat stemming a foul
        // tide is not closing at its boat speed, and one carried by a fair one
        // is closing at rather more.
        const vmg = ground.speedKts * Math.cos(toRad(angleBetween(ground.courseDeg, toDestination)));
        if (vmg > closingVmg) {
          closingVmg = vmg;
          closingHeading = heading;
          closingTwa = twa;
          closingMotoring = underPower;
          closingGround = ground.speedKts;
        }
      }

      const arrivalBlocked =
        avoiding && obstacles!.blocks(node.lat, node.lon, destination.lat, destination.lon) !== null;

      // Arriving on fumes is still arriving; arriving after the tank is empty
      // is not. Measured to the moment of landfall rather than to the end of
      // the step, so the last part-hour of fuel is available to finish on.
      const arrivalOutOfFuel =
        fuelHours !== null &&
        closingVmg > 0 &&
        (node.timeMs - departure) / 3_600_000 + remaining / closingVmg > fuelHours;

      if (closingVmg > 0 && remaining <= closingVmg * stepHours && !arrivalBlocked && !arrivalOutOfFuel) {
        const arrivalMs = node.timeMs + (remaining / closingVmg) * 3_600_000;
        const arrivalHours = remaining / closingVmg;
        const arrival: Node = {
          lat: destination.lat,
          lon: destination.lon,
          timeMs: arrivalMs,
          parent: node,
          headingDeg: closingHeading,
          twaDeg: closingTwa,
          twsKts: windForSails.speedKts,
          windFromDeg: windForSails.directionDeg,
          gustKts: sample.gustKts ?? null,
          boatSpeedKts: speedIn(closingHeading, closingTwa).speed,
          distanceNm: remaining,
          tackSide: relativeSide(closingHeading, windForSails.directionDeg),
          ...seaOf(closingHeading),
          motoring: closingMotoring,
          motorHours: node.motorHours + (closingMotoring ? arrivalHours : 0),
          ...streamOf(),
          groundSpeedKts: closingGround || closingVmg
        };
        const legs = buildLegs(arrival, polar.name, propulsion);
        return {
          reachedDestination: true,
          legs,
          etaHours: Math.round(((arrivalMs - departure) / 3_600_000) * 100) / 100,
          distanceNm: totalDistance(legs),
          directDistanceNm: Math.round(directDistanceNm * 100) / 100,
          warnings: [
            ...warnings,
            ...seaStateWarnings(waves, waveSampleCount, seaLimit),
            ...currentWarnings(currents, currentSampleCount, legs),
            ...(isMotorVessel
              ? powerWarnings(fuel, legs, false)
              : [...motoringWarnings(motoring, legs), ...watchWarnings(nightPolicy, legs)])
          ],
          polarName: polar.name,
          maxWaveHeightM: worstSeas(legs),
          maxCurrentKts: worstCurrent(legs),
          fronts,
          ...propulsionReport(legs, propulsion, motoring, fuel, false)
        };
      }

      for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
        // The tank is empty: this position is as far as the vessel gets, so
        // nothing expands from it. Counted rather than silently skipped, so
        // the empty step below can name fuel as the reason instead of blaming
        // the weather for something the weather did not do.
        if (fuelStopsExpansion) { outOfFuel++; break; }
        if (angleBetween(heading, toDestination) > maxOffCourseDeg) continue;

        const twa = angleBetween(heading, windForSails.directionDeg);
        const { speed, motoring: underPower } = speedIn(heading, twa);
        if (speed <= 0) { unsailable++; continue; }

        // A manoeuvre eats into the step: the boat is slow through the turn and
        // the crew is busy, so the same hour covers less ground.
        const side = relativeSide(heading, windForSails.directionDeg);
        const manoeuvring = node.tackSide !== 0 && side !== 0 && side !== node.tackSide;
        let penaltyMinutes = manoeuvring ? manoeuvreCost : 0;
        if (manoeuvring && nightPolicy && darkHere) {
          // Which manoeuvre this is, by the same test `buildLegs` uses: across
          // the wind forward of the beam is a tack, behind it a gybe.
          const gybing = (node.twaDeg + twa) / 2 >= 90;
          const nightCost =
            (gybing ? nightPolicy.gybePenaltyMinutes : nightPolicy.tackPenaltyMinutes) ?? 0;
          if (!Number.isFinite(nightCost)) { forbiddenAtNight++; continue; }
          penaltyMinutes += nightCost;
        }
        const usableHours = Math.max(0, stepHours - penaltyMinutes / 60);
        // Steered through the water, carried over the ground.
        const ground = groundTrack(heading, speed);
        const legDistance = ground.speedKts * usableHours;
        if (legDistance <= 0) continue;
        const point = destinationPoint(node.lat, node.lon, ground.courseDeg, legDistance);
        // Discard during the search, not after it: a leg pruned here lets the
        // frontier find its way around the obstruction, whereas trimming a
        // finished route would just cut a corner off it.
        if (avoiding && obstacles!.blocks(node.lat, node.lon, point.lat, point.lon)) {
          blockedByLand++;
          continue;
        }
        candidates.push({
          lat: point.lat,
          lon: point.lon,
          timeMs: nextTime,
          parent: node,
          headingDeg: heading,
          twaDeg: twa,
          twsKts: windForSails.speedKts,
          windFromDeg: windForSails.directionDeg,
          gustKts: sample.gustKts ?? null,
          boatSpeedKts: speed,
          distanceNm: legDistance,
          tackSide: side,
          ...seaOf(heading),
          motoring: underPower,
          motorHours: node.motorHours + (underPower ? usableHours : 0),
          ...streamOf(),
          groundSpeedKts: ground.speedKts
        });
      }
    }

    if (!candidates.length) {
      const where = step === 0 ? 'from the starting position' : 'from the last position reached';
      // Fuel first, and on its own, because it is the one cause here that no
      // other departure and no other forecast will fix. Every other reason a
      // route stops short is about the weather; this one is about the vessel.
      if (outOfFuel) {
        ranOutOfFuel = true;
        warnings.push(
          `The usable fuel aboard runs out after about ${Math.round(fuelHours!)} hours under way, ` +
            'short of the destination. This is the vessel\'s range, not the weather: a different ' +
            'departure will not reach it either.'
        );
        break;
      }
      // Said first and on its own terms, because it is the one cause here the
      // skipper chose: the limit is a setting, and "your limit stopped this"
      // is a different sentence from "the sea stopped this".
      if (tooRough) {
        warnings.push(
          step === 0
            ? `The sea at the departure point is already above the ${seaLimit} m limit set, so no ` +
                'passage could be started. A later departure may find it down.'
            : `The route stopped: every position it could sail on from is in seas above the ` +
                `${seaLimit} m limit set.`
        );
      }
      // Everything else the search ran into. Skipped entirely when the sea
      // limit was the only thing in the way, so a route the skipper's own
      // setting stopped is not also told the wind was against it.
      // Rare, but it has its own sentence because every other explanation
      // would be a lie: there is wind, there is sea room, and the boat is
      // perfectly able to sail — it is the watch policy that closed the door.
      if (forbiddenAtNight && !blockedByLand && !unsailable) {
        warnings.push(
          `The wind has shifted so far that every course open ${where} would mean a sail change in ` +
            'the dark, which this passage was planned not to do. Allow night manoeuvres, or accept ' +
            'that the boat holds its tack until first light.'
        );
      }
      if (noWind || calm || blockedByLand || unsailable) {
        if ((noWind || calm) && !blockedByLand && !unsailable) {
          warnings.push(
            step === 0
              ? 'No forecast wind at the departure point and time, so no route could be started.'
              : 'The route stalled: no usable wind was forecast ahead of the last position reached.'
          );
        } else if (blockedByLand && !unsailable) {
          warnings.push(
            `Every course ${where} runs into land within one step of the search. ` +
              'Start further offshore, where a passage plan is the right tool.'
          );
        } else if (unsailable && !blockedByLand) {
          warnings.push(
            `The wind is dead against this passage ${where}: every course open to the search is ` +
              'inside the angle this boat cannot sail. Try a later departure.'
          );
        } else {
          // Both, which is the boxed-in case: what land leaves open, the wind
          // forbids. Naming both is the whole point — either alone reads as a
          // different and fixable problem.
          warnings.push(
            `There is no way out ${where}: the courses that clear the land are ones this boat ` +
              'cannot sail against the forecast wind, and the courses it could sail run ashore. ' +
              'Beating out of somewhere this tight is pilotage, which this planner does not do — ' +
              'start from open water, or wait for a shift.'
          );
        }
      }
      break;
    }

    recordFront(step, candidates, nextTime);

    // Prune to one survivor per bearing-from-origin sector: the point that got
    // FURTHEST from the origin. That is what makes this an isochrone rather
    // than a greedy walk — keeping whichever point is nearest the destination
    // instead would collapse the search onto the rhumb line and never discover
    // that a detour into stronger wind arrives sooner. Without pruning at all,
    // the frontier multiplies by the heading count every step.
    const bins = new Map<number, { node: Node; reach: number }>();
    let stepClosest: Node | null = null;
    let stepClosestRemaining = Infinity;
    for (const candidate of candidates) {
      const sector = Math.round(
        bearingDeg(start.lat, start.lon, candidate.lat, candidate.lon) / sectorWidthDeg
      );
      const reach = distanceNm(start.lat, start.lon, candidate.lat, candidate.lon);
      const held = bins.get(sector);
      if (!held || reach > held.reach) bins.set(sector, { node: candidate, reach });

      // Tracked separately from pruning, so a route that never arrives can
      // still report its closest approach.
      const remaining = distanceNm(candidate.lat, candidate.lon, destination.lat, destination.lon);
      if (remaining < stepClosestRemaining) {
        stepClosestRemaining = remaining;
        stepClosest = candidate;
      }
      if (remaining < bestRemaining) {
        bestRemaining = remaining;
        best = candidate;
      }
    }

    frontier = [...bins.values()].map((b) => b.node);

    // Keep whichever point came nearest the destination, even if a sector-mate
    // sailed further. Pruning on reach alone lets the front fly past the
    // destination — it strands the search a mile short of a windward landfall,
    // because the node that could have closed was dropped for one that
    // overshot. The endgame needs the near miss, not the long shot.
    if (stepClosest && !frontier.includes(stepClosest)) {
      frontier.push(stepClosest);
    }
  }

  if (
    !ranOutOfFuel &&
    !warnings.some((w) => w.startsWith('The route stalled') || w.startsWith('No forecast wind'))
  ) {
    warnings.push(
      `The destination was not reached within ${maxHours} hours; this is the best progress found.`
    );
  }

  const legs = buildLegs(best, polar.name, propulsion);
  return {
    reachedDestination: false,
    legs,
    etaHours: Math.round(((best.timeMs - departure) / 3_600_000) * 100) / 100,
    distanceNm: totalDistance(legs),
    directDistanceNm: Math.round(directDistanceNm * 100) / 100,
    warnings: [
      ...warnings,
      ...seaStateWarnings(waves, waveSampleCount, seaLimit),
      ...currentWarnings(currents, currentSampleCount, legs),
      ...(isMotorVessel
        ? powerWarnings(fuel, legs, ranOutOfFuel)
        : [...motoringWarnings(motoring, legs), ...watchWarnings(nightPolicy, legs)])
    ],
    polarName: polar.name,
    maxWaveHeightM: worstSeas(legs),
    maxCurrentKts: worstCurrent(legs),
    fronts,
    ...propulsionReport(legs, propulsion, motoring, fuel, ranOutOfFuel)
  };
}
