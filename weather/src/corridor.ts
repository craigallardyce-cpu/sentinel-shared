import {
  distanceNm,
  type RouteResult,
  type RouteFront,
  type RouteLeg,
  type WaveSampler,
  type WindSampler
} from './routing.js';

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

const DEFAULT_LIMITS: Required<HazardLimits> = { windKts: 30, gustKts: 40, waveM: 4 };

/**
 * How far under the limit the old forecast had to be for a breach to count as
 * genuinely new.
 *
 * Without this, "not in your plan" fires on arithmetic. Two forecasts fetched
 * twenty minutes apart, interpolated from grids with different bounds, will
 * disagree in the third decimal — and a sea that was 1.09 m against a 1.10 m
 * limit and is now 1.11 m gets reported as weather that has appeared since
 * departure. It has not; the number moved by a centimetre.
 *
 * Ten percent is a margin, not a threshold on the hazard itself: the breach is
 * still reported, it is simply not called NEW unless the old forecast was
 * comfortably clear of the limit. Crying wolf is the one failure mode this
 * feature cannot survive — an advisory that is wrong at the margin gets muted,
 * and then it is not there for the gale.
 */
const NEW_BREACH_MARGIN = 0.9;

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

function breachesAt(
  lat: number,
  lon: number,
  timeMs: number,
  samplers: Samplers,
  limits: Required<HazardLimits>
): Breach[] {
  const out: Breach[] = [];
  const w = samplers.wind(lat, lon, timeMs);
  if (w && Number.isFinite(w.speedKts) && w.speedKts >= limits.windKts) {
    out.push({ kind: 'wind', value: Math.round(w.speedKts * 10) / 10, limit: limits.windKts, isNew: false });
  }
  if (w && w.gustKts !== null && w.gustKts !== undefined && w.gustKts >= limits.gustKts) {
    out.push({ kind: 'gust', value: Math.round(w.gustKts * 10) / 10, limit: limits.gustKts, isNew: false });
  }
  const s = samplers.waves?.(lat, lon, timeMs);
  if (s && Number.isFinite(s.heightM) && s.heightM >= limits.waveM) {
    out.push({ kind: 'sea', value: Math.round(s.heightM * 10) / 10, limit: limits.waveM, isNew: false });
  }
  return out;
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
export function scanHazards(
  route: RouteResult,
  samplers: Samplers,
  options: { limits?: HazardLimits; plannedWith?: Samplers; now?: number } = {}
): HazardScan {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const hazards: Hazard[] = [];
  const comparedToPlan = Boolean(options.plannedWith);
  const now = options.now ?? (route.legs.length ? Date.parse(route.legs[0].time) : 0);

  for (const leg of route.legs) {
    const timeMs = Date.parse(leg.time);
    if (!Number.isFinite(timeMs)) continue;
    const breaches = breachesAt(leg.lat, leg.lon, timeMs, samplers, limits);
    if (!breaches.length) continue;

    // Was this already there when the passage was planned? Compared at the
    // same position and hour, so a low that merely deepened a little still
    // counts as known, and one that has arrived a day early does not.
    //
    // Kind by kind, not position by position. A leg that always had a big sea
    // and has since grown gale-force gusts must report the gusts as new.
    if (options.plannedWith) {
      // Judged against a SOFTENED limit, so a value that was already close to
      // breaking counts as known. See NEW_BREACH_MARGIN.
      const softened: Required<HazardLimits> = {
        windKts: limits.windKts * NEW_BREACH_MARGIN,
        gustKts: limits.gustKts * NEW_BREACH_MARGIN,
        waveM: limits.waveM * NEW_BREACH_MARGIN
      };
      const before = breachesAt(leg.lat, leg.lon, timeMs, options.plannedWith, softened);
      const nearlyBrokenBefore = new Set(before.map((b) => b.kind));
      for (const b of breaches) b.isNew = !nearlyBrokenBefore.has(b.kind);
    }
    const isNew = breaches.some((b) => b.isNew);

    hazards.push({
      lat: leg.lat,
      lon: leg.lon,
      time: leg.time,
      hoursAway: Math.round(((timeMs - now) / 3_600_000) * 10) / 10,
      breaches,
      isNew
    });
  }

  // Worst is judged on how far over the limit a breach is, in proportion —
  // so 45 knots against a 30-knot limit outranks 4.5 m against 4 m, which is
  // the order a skipper reads them in. New hazards win ties, because an
  // unknown gale outranks one already accepted.
  const severity = (h: Hazard) =>
    Math.max(...h.breaches.map((b) => b.value / b.limit)) + (h.isNew ? 0.001 : 0);

  const worst = hazards.length
    ? hazards.reduce((a, b) => (severity(a) >= severity(b) ? a : b))
    : null;
  const soonest = hazards.length
    ? hazards.reduce((a, b) => (a.hoursAway <= b.hoursAway ? a : b))
    : null;

  return { hazards, worst, soonest, comparedToPlan, limits };
}

export interface CorridorBand {
  timeMs: number;
  hoursFromDeparture: number;
  /** Clear, reachable positions at this hour. Never a path — an unordered set. */
  points: Array<{ lat: number; lon: number }>;
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

const fronts = (route: RouteResult): RouteFront[] => route.fronts ?? [];

/** Below this share of the widest band, a narrowing is worth calling a decision. */
const PINCH_RATIO = 0.55;

/**
 * How much slower than the best route a position may still be worth being in.
 *
 * This is the filter that makes a corridor a corridor. Without it the "corridor"
 * is the whole reachable set — everywhere the boat could physically get to —
 * which on an ocean passage fans out across the entire chart and reads as
 * scattered blobs rather than as advice. Reachability is not the question. The
 * question is which water still gets you there in about the time the best route
 * would, and that is a much narrower set.
 *
 * Ten percent of the passage: wide enough that a real choice between two sides
 * of a weather system stays visible, tight enough that the answer is a band.
 */
const NEAR_OPTIMAL_TOLERANCE = 0.1;

/**
 * Positions on a front are ranked by their spread, which is O(n²) on a set that
 * can be a few hundred wide. Capped so a long passage cannot quietly cost
 * seconds; the sample is even across the front, so the width it measures is
 * the same width.
 */
const MAX_POINTS_PER_BAND = 60;

function evenSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

function spreadNm(points: Array<{ lat: number; lon: number }>): number {
  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distanceNm(points[i].lat, points[i].lon, points[j].lat, points[j].lon);
      if (d > worst) worst = d;
    }
  }
  return Math.round(worst * 10) / 10;
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
export function buildCorridor(
  route: RouteResult,
  destination: { lat: number; lon: number },
  options: { toleranceFraction?: number } = {}
): Corridor {
  const bands: CorridorBand[] = [];
  const tolerance = options.toleranceFraction ?? NEAR_OPTIMAL_TOLERANCE;

  // Judging near-optimal needs something to be near. A passage that never
  // reached its destination has no best time to measure against, and inventing
  // one would draw a confident corridor around a route that failed.
  if (!route.reachedDestination || !(route.etaHours > 0) || !(route.directDistanceNm > 0)) {
    return { bands: [], pinch: null, widest: null };
  }

  /**
   * How much further from the destination than the best route a position may
   * be, at the same moment, and still count as being in the corridor.
   *
   * Measured against the OPTIMAL ROUTE'S OWN PROGRESS rather than against a
   * speed estimate, which is the second attempt and the right one. The first
   * tried elapsed-plus-remaining-at-average-VMG, and a test caught it failing
   * on exactly the passages this feature exists for: where a route detours
   * around weather, the straight-line distance still to run is much larger
   * than the average pace implies, because that pace already has the detour
   * baked into it. Every position was judged hopeless and the corridor came
   * back empty.
   *
   * Comparing like with like — how far along was the best route at this hour,
   * how far along is this position — needs no speed estimate and cannot be
   * fooled by a dog-leg.
   */
  // Proportional to how far there still is to go, NOT a fixed distance.
  //
  // A constant slack does not converge: near the destination the best route's
  // remaining distance goes to zero while the allowance stays put, so the
  // corridor ends as a blob tens of miles wide around the arrival instead of
  // closing on it. Measured on one passage it was still 106 nm across an hour
  // before landfall, which is not a corridor and is not true — there is no
  // time left in which to make up that distance.
  //
  // As a share of the baseline it says something scale-free and correct: you
  // may be up to a tenth further from the destination than the best route is,
  // at this moment. Generous early, and nothing at all at the end.
  const slackFor = (baselineNm: number) => tolerance * baselineNm;

  /** Where the best route had got to by a given moment. */
  const bestRemainingAt = (timeMs: number): number | null => {
    let closest: RouteLeg | null = null;
    let bestGap = Infinity;
    for (const leg of route.legs) {
      const gap = Math.abs(Date.parse(leg.time) - timeMs);
      if (gap < bestGap) { bestGap = gap; closest = leg; }
    }
    return closest
      ? distanceNm(closest.lat, closest.lon, destination.lat, destination.lon)
      : null;
  };

  for (const front of fronts(route)) {
    const baseline = bestRemainingAt(front.timeMs);
    const worthwhile = front.points.filter((p) => {
      if (!p.clear) return false;
      if (baseline === null) return false;
      const remaining = distanceNm(p.lat, p.lon, destination.lat, destination.lon);
      // Further from the destination than the best route was at this hour, by
      // more than the slack, is water the boat can reach and should not be in.
      return remaining <= baseline + slackFor(baseline);
    });
    const clear = evenSample(
      worthwhile.map((p) => ({ lat: p.lat, lon: p.lon })),
      MAX_POINTS_PER_BAND
    );
    if (clear.length < 2) continue;
    bands.push({
      timeMs: front.timeMs,
      hoursFromDeparture: front.hoursFromDeparture,
      points: clear,
      widthNm: spreadNm(clear)
    });
  }

  if (!bands.length) return { bands, pinch: null, widest: null };

  const widest = bands.reduce((a, b) => (a.widthNm >= b.widthNm ? a : b));
  const narrowest = bands.reduce((a, b) => (a.widthNm <= b.widthNm ? a : b));

  // The first and last bands are narrow because the passage starts and ends at
  // a point, not because anything is deciding — so a pinch only counts if it is
  // somewhere in the middle.
  const isInterior = narrowest !== bands[0] && narrowest !== bands[bands.length - 1];
  const pinch =
    isInterior && widest.widthNm > 0 && narrowest.widthNm / widest.widthNm <= PINCH_RATIO
      ? narrowest
      : null;

  return { bands, pinch, widest };
}

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

export function buildAdvisory(
  route: RouteResult,
  scan: HazardScan,
  corridor: Corridor,
  filedEtaHours: number | null = null
): Advisory {
  const fresh = scan.hazards.filter((h) => h.isNew);
  // A new hazard always leads, even where a known one is worse: the known one
  // was accepted at departure and the new one has never been decided about.
  const pool = fresh.length ? fresh : scan.hazards;
  // Ranked on the breaches that are actually new when there are any, so a leg
  // whose old hazard is severe cannot outrank one whose NEW hazard is worse.
  const severity = (h: Hazard) => {
    const relevant = fresh.length ? h.breaches.filter((b) => b.isNew) : h.breaches;
    const scored = relevant.length ? relevant : h.breaches;
    return Math.max(...scored.map((b) => b.value / b.limit));
  };
  const headline = pool.length ? pool.reduce((a, b) => (severity(a) >= severity(b) ? a : b)) : null;

  return {
    headline,
    headlineIsNew: Boolean(headline?.isNew),
    scan,
    corridor,
    costHours:
      filedEtaHours !== null && Number.isFinite(route.etaHours)
        ? Math.round((route.etaHours - filedEtaHours) * 10) / 10
        : null
  };
}

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
 * How far a forecast may move before it is worth mentioning.
 *
 * Wide enough to swallow the disagreement between two grids interpolated at
 * slightly different bounds, which is the noise that makes a comparison cry
 * wolf. A plan is not "changed" because the wind is a knot different from a
 * number somebody wrote down five days ago.
 */
const TRACKING_WIND_KTS = 5;
const TRACKING_WAVE_M = 0.5;

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
export function compareToPlan(
  checkpoints: PlanCheckpoint[],
  samplers: Samplers,
  options: { now?: number; windToleranceKts?: number; waveToleranceM?: number } = {}
): PlanComparison {
  const now = options.now ?? Date.now();
  const windTol = options.windToleranceKts ?? TRACKING_WIND_KTS;
  const waveTol = options.waveToleranceM ?? TRACKING_WAVE_M;

  const segments: PlanSegment[] = [];

  for (const cp of checkpoints) {
    const timeMs = Date.parse(cp.time);
    if (!Number.isFinite(timeMs) || timeMs < now) continue;

    const wind = samplers.wind(cp.lat, cp.lon, timeMs);
    const sea = samplers.waves?.(cp.lat, cp.lon, timeMs);
    const nowWindKts = wind && Number.isFinite(wind.speedKts) ? Math.round(wind.speedKts * 10) / 10 : null;
    const nowWaveM = sea && Number.isFinite(sea.heightM) ? Math.round(sea.heightM * 10) / 10 : null;

    const windDeltaKts =
      cp.windKts !== null && nowWindKts !== null
        ? Math.round((nowWindKts - cp.windKts) * 10) / 10
        : null;
    const waveDeltaM =
      cp.waveM !== null && nowWaveM !== null ? Math.round((nowWaveM - cp.waveM) * 10) / 10 : null;

    // Worsening wins over easing: a passage where the wind has dropped and the
    // sea has got up is not "mixed", it is worse, and that is what a crew
    // needs to hear.
    let verdict: SegmentVerdict = 'unknown';
    if (windDeltaKts !== null || waveDeltaM !== null) {
      const worse =
        (windDeltaKts !== null && windDeltaKts > windTol) ||
        (waveDeltaM !== null && waveDeltaM > waveTol);
      const better =
        (windDeltaKts === null || windDeltaKts < -windTol) &&
        (waveDeltaM === null || waveDeltaM < -waveTol);
      verdict = worse ? 'worsening' : better ? 'easing' : 'tracking';
    }

    segments.push({
      time: cp.time,
      hoursAway: Math.round(((timeMs - now) / 3_600_000) * 10) / 10,
      lat: cp.lat,
      lon: cp.lon,
      verdict,
      plannedWindKts: cp.windKts,
      nowWindKts,
      windDeltaKts,
      plannedWaveM: cp.waveM,
      nowWaveM,
      waveDeltaM
    });
  }

  const judged = segments.filter((s) => s.verdict !== 'unknown');
  const worsening = segments.filter((s) => s.verdict === 'worsening');
  const verdict: SegmentVerdict = worsening.length
    ? 'worsening'
    : judged.length
      ? (judged.every((s) => s.verdict === 'easing') ? 'easing' : 'tracking')
      : 'unknown';

  return {
    segments,
    verdict,
    // The first divergence, not the worst: it is the one the crew meets, and
    // the one there is still time to do something about.
    divergesAt: worsening.length
      ? worsening.reduce((a, b) => (a.hoursAway <= b.hoursAway ? a : b))
      : null,
    trackingFraction: judged.length
      ? Math.round((judged.filter((s) => s.verdict === 'tracking').length / judged.length) * 100) / 100
      : 0
  };
}
