import type { RouteLeg, RouteResult } from './routing.js';

/**
 * What a passage is actually like, as distributions rather than extremes.
 *
 * A route already knows the wind, the sea and the angle it was sailed at for
 * every hour of it, and until now all of that was thrown away except the
 * worst value. That loses the only question a skipper is really asking. "Worst
 * seas 3 m" is produced identically by a passage that touches 3 m for twenty
 * minutes and one that spends two days in it, and those are not the same
 * passage.
 *
 * So everything here is time-weighted. The unit is hours spent, not legs
 * counted: the final leg into a destination is usually a fraction of a step,
 * and counting it equally with a full hour would quietly overweight the
 * landfall conditions in every summary.
 *
 * Nothing in here is a new claim about the world. It is the same forecast the
 * route was computed from, reported at the resolution the decision needs — so
 * it inherits the route's warnings and adds none of its own.
 */

/** One bucket of a distribution: how long the passage spent in it. */
export interface Band {
  /** Inclusive lower bound of the band, in the distribution's own units. */
  from: number;
  /** Exclusive upper bound, or null for the open-ended top band. */
  to: number | null;
  label: string;
  hours: number;
  /** Share of the covered passage, 0-1. */
  fraction: number;
}

export interface PassageSummary {
  /** Hours the summary covers — the passage minus its zero-length first leg. */
  hours: number;
  wind: {
    minKts: number;
    maxKts: number;
    /** Time-weighted mean, not the mean of the legs. */
    meanKts: number;
    /** Worst gust anywhere on the passage, where the model published gusts. */
    maxGustKts: number | null;
  };
  /** Share of time close-hauled, reaching and running. Sums to 1. */
  pointOfSail: { upwind: number; reaching: number; downwind: number };
  windBands: Band[];
  waveBands: Band[];
  /**
   * Share of the passage spent hard on the wind in a real breeze.
   *
   * The single most useful compound number in a passage summary. Upwind is
   * tolerable and breeze is tolerable; it is the two together that soaks the
   * boat, stops anyone sleeping and makes crews swear off passage-making.
   * Neither of the distributions above can show it, because it lives in the
   * overlap between them.
   */
  hardUpwind: { fraction: number; hours: number; thresholdKts: number; twaDeg: number };
  /**
   * Share of the passage the marine forecast actually reached, 0-1.
   *
   * Reported as a share rather than a yes/no, because partial coverage is the
   * normal case — the marine models run out both further ahead in time and
   * closer in to a coast than the atmospheric ones. A wave distribution over
   * 60% of a passage is worth having and worth labelling; one presented as if
   * it covered all of it is not.
   */
  seaStateCoverage: number;
}

/** Upwind below this true wind angle, downwind above the other. */
const REACHING_FROM_DEG = 60;
const REACHING_TO_DEG = 120;

/** Where hard-upwind starts: close-hauled, and enough breeze to be wet. */
const HARD_UPWIND_TWA_DEG = 60;
const HARD_UPWIND_KTS = 15;

/**
 * Wind bands, in knots.
 *
 * Chosen around what a cruising boat does rather than around round numbers: 8
 * is roughly where a cruiser stops sailing and starts motoring, 20 is the
 * first reef, 30 is the second and the point where a passage becomes work, 40
 * is heavy weather.
 */
export const WIND_BANDS_KTS = [0, 8, 20, 30, 40];

/**
 * Sea bands, in metres.
 *
 * Whole metres of significant wave height. Finer bands would imply the models
 * resolve sea state better than they do, and a cruiser's decisions do not turn
 * on half a metre at these heights anyway.
 */
export const WAVE_BANDS_M = [0, 1, 2, 3, 4];

function bandLabel(from: number, to: number | null, unit: string): string {
  if (from === 0) return `<${to}${unit}`;
  if (to === null) return `>${from}${unit}`;
  return `${from}–${to}${unit}`;
}

function distribute(
  edges: number[],
  unit: string,
  samples: Array<{ value: number; hours: number }>
): Band[] {
  const total = samples.reduce((sum, s) => sum + s.hours, 0);
  return edges.map((from, i) => {
    const to = i === edges.length - 1 ? null : edges[i + 1];
    const hours = samples
      .filter((s) => s.value >= from && (to === null || s.value < to))
      .reduce((sum, s) => sum + s.hours, 0);
    return {
      from,
      to,
      label: bandLabel(from, to, unit),
      hours: Math.round(hours * 100) / 100,
      fraction: total > 0 ? hours / total : 0
    };
  });
}

/**
 * The hours each leg was sailed for, paired with the conditions it was sailed
 * in.
 *
 * A leg reports the conditions sampled at its *start* and the time of its
 * *end*, which is the convention the router has always used — so the hours a
 * leg's conditions applied for run from the previous leg's timestamp to its
 * own. The first leg is the departure point itself: zero length, no wind
 * sampled, and excluded here rather than counted as a calm.
 */
function legHours(legs: RouteLeg[]): Array<{ leg: RouteLeg; hours: number }> {
  const out: Array<{ leg: RouteLeg; hours: number }> = [];
  for (let i = 1; i < legs.length; i++) {
    const hours = (Date.parse(legs[i].time) - Date.parse(legs[i - 1].time)) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0) continue;
    out.push({ leg: legs[i], hours });
  }
  return out;
}

/**
 * Summarise a computed route.
 *
 * Returns null for a route with nothing to summarise — one that never left the
 * departure point. That is a real outcome (a start inside an obstacle, a sea
 * above the limit set, a flat calm) and the route's own warnings already
 * explain it far better than an all-zero summary would.
 */
export function summarisePassage(route: RouteResult): PassageSummary | null {
  const sailed = legHours(route.legs);
  if (!sailed.length) return null;

  const hours = sailed.reduce((sum, s) => sum + s.hours, 0);
  if (hours <= 0) return null;

  let minKts = Infinity;
  let maxKts = -Infinity;
  let windHours = 0;
  let maxGustKts: number | null = null;
  let upwind = 0;
  let reaching = 0;
  let downwind = 0;
  let hardUpwindHours = 0;
  let seaHours = 0;

  const windSamples: Array<{ value: number; hours: number }> = [];
  const waveSamples: Array<{ value: number; hours: number }> = [];

  for (const { leg, hours: h } of sailed) {
    if (Number.isFinite(leg.twsKts)) {
      minKts = Math.min(minKts, leg.twsKts);
      maxKts = Math.max(maxKts, leg.twsKts);
      windHours += leg.twsKts * h;
      windSamples.push({ value: leg.twsKts, hours: h });
    }
    if (leg.gustKts !== null && Number.isFinite(leg.gustKts)) {
      maxGustKts = maxGustKts === null ? leg.gustKts : Math.max(maxGustKts, leg.gustKts);
    }

    const twa = leg.twaDeg;
    if (twa < REACHING_FROM_DEG) upwind += h;
    else if (twa <= REACHING_TO_DEG) reaching += h;
    else downwind += h;

    if (twa < HARD_UPWIND_TWA_DEG && leg.twsKts > HARD_UPWIND_KTS) hardUpwindHours += h;

    // Legs the marine forecast did not reach are left out of the sea
    // distribution rather than counted as calm water, and the coverage figure
    // is what says how much of the passage that was.
    if (leg.waveHeightM !== null && Number.isFinite(leg.waveHeightM)) {
      waveSamples.push({ value: leg.waveHeightM, hours: h });
      seaHours += h;
    }
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  return {
    hours: Math.round(hours * 100) / 100,
    wind: {
      minKts: Number.isFinite(minKts) ? Math.round(minKts * 10) / 10 : 0,
      maxKts: Number.isFinite(maxKts) ? Math.round(maxKts * 10) / 10 : 0,
      meanKts: hours > 0 ? Math.round((windHours / hours) * 10) / 10 : 0,
      maxGustKts: maxGustKts === null ? null : Math.round(maxGustKts * 10) / 10
    },
    pointOfSail: {
      upwind: round3(upwind / hours),
      reaching: round3(reaching / hours),
      downwind: round3(downwind / hours)
    },
    windBands: distribute(WIND_BANDS_KTS, 'kt', windSamples),
    waveBands: distribute(WAVE_BANDS_M, 'm', waveSamples),
    hardUpwind: {
      fraction: round3(hardUpwindHours / hours),
      hours: Math.round(hardUpwindHours * 100) / 100,
      thresholdKts: HARD_UPWIND_KTS,
      twaDeg: HARD_UPWIND_TWA_DEG
    },
    seaStateCoverage: round3(seaHours / hours)
  };
}
