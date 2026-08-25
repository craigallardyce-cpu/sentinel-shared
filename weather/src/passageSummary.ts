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
  /**
   * How much of the passage the sea arrives in step with the boat's own roll,
   * or null when no roll period was given.
   *
   * This is the honest half of what a seakeeping model would tell you. Real
   * RMS roll and vertical acceleration come from a hull model — dimensions,
   * displacement, metacentric height — that this app does not have and should
   * not guess at. But resonance needs only one number, and it is a number the
   * owner can MEASURE rather than one anybody has to infer: rock the boat at
   * the dock, time several full rolls, divide. That is the same bargain the
   * learned polar strikes, and it is why this reports resonance rather than
   * degrees of roll it cannot know.
   *
   * Resonant rolling is also the thing that actually ruins a passage. A boat
   * can be perfectly safe and completely miserable, and this is usually why.
   */
  rollResonance: {
    fraction: number;
    hours: number;
    rollPeriodS: number;
    /** Hours the encounter period could not be computed — running with the sea. */
    unknownHours: number;
  } | null;
  /**
   * How much of the passage is sailed in the dark, and how much of the work.
   *
   * Nobody in the comparison this came from reports either, and for a
   * short-handed crew they outrank half of what is reported instead. Hours of
   * darkness set the watch bill. Manoeuvres in the dark are the ones that go
   * wrong: a gybe at 0300 with one person awake is a different act from the
   * same gybe at noon.
   */
  night: { fraction: number; hours: number; manoeuvres: number };
  /**
   * Wind against current, where both are real enough to matter.
   *
   * The compound metric that justifies fetching currents at all. Wind over
   * tide is where an ordinary sea stands up, shortens and breaks, and the
   * wave distribution above cannot show it — the forecast height does not know
   * the water underneath it is running the other way.
   */
  windAgainstCurrent: { fraction: number; hours: number } | null;
  /**
   * What it is like where the passage ends, which is where the risk is.
   *
   * Arriving at an unfamiliar harbour at 0300 in twenty-five knots is the real
   * hazard of most passages, and it is invisible in every average and every
   * distribution — a summary can call a passage benign and still be describing
   * one that finishes in the dark in a gale. Null for a route that never
   * arrived, because a landfall that did not happen has no conditions.
   */
  landfall: {
    atNight: boolean;
    twsKts: number;
    gustKts: number | null;
    waveHeightM: number | null;
    time: string;
  } | null;
}

export interface SummaryOptions {
  /**
   * The boat's natural roll period in seconds, measured rather than modelled.
   * Omit and no resonance is reported, which is the right outcome: a guessed
   * roll period would produce a confident answer about the one thing here that
   * a skipper would actually change plans over.
   */
  rollPeriodS?: number | null;
}

/**
 * The period at which the boat meets the waves, in seconds.
 *
 * Not the same as the wave period, and the difference is the whole point: a
 * boat punching into a sea meets it far more often than a boat running away
 * from the same sea. The standard deep-water relation is
 *
 *     ω_e = ω − (ω²·v/g)·cos μ
 *
 * where μ is the angle between the boat's heading and the direction the waves
 * are TRAVELLING. `waveAngleDeg` on a leg is measured against where the waves
 * come FROM — 0 is a head sea — so μ is its supplement.
 *
 * Returns null when the boat is running with the waves at close to their own
 * speed. There the encounter period goes to infinity and then negative as the
 * waves start overtaking from ahead, and neither answer means anything useful
 * to a cruising boat. Saying nothing is better than reporting a 400-second
 * roll period.
 */
export function encounterPeriodS(
  wavePeriodS: number,
  waveAngleDeg: number,
  boatSpeedKts: number
): number | null {
  if (!Number.isFinite(wavePeriodS) || wavePeriodS <= 0) return null;
  const g = 9.81;
  const speedMs = (boatSpeedKts * 1852) / 3600;
  const omega = (2 * Math.PI) / wavePeriodS;
  // Waves come FROM waveAngleDeg off the bow; they TRAVEL toward its supplement.
  const mu = (180 - Math.abs(waveAngleDeg)) * (Math.PI / 180);
  const omegaE = omega - ((omega * omega * speedMs) / g) * Math.cos(mu);
  if (!Number.isFinite(omegaE) || omegaE <= 1e-6) return null;
  return (2 * Math.PI) / omegaE;
}

/**
 * The sun's elevation above the horizon, in degrees.
 *
 * The low-precision solar position algorithm, good to about a hundredth of a
 * degree — which is three or four orders of magnitude better than a passage
 * plan needs, and worth having because it is arithmetic rather than a service.
 * A boat mid-ocean can work out when it gets dark with no network at all,
 * which is the same reason the routing itself runs client-side.
 */
export function solarElevationDeg(lat: number, lon: number, timeMs: number): number {
  const rad = Math.PI / 180;
  // Days since J2000.0.
  const d = timeMs / 86_400_000 + 2440587.5 - 2451545.0;
  const meanAnomaly = (357.529 + 0.98560028 * d) * rad;
  const meanLongitude = (280.459 + 0.98564736 * d) * rad;
  const eclipticLongitude =
    meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.00000036 * d) * rad;

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  // Greenwich mean sidereal time, in degrees, then local hour angle.
  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  const hourAngle = (gmstHours * 15 + lon) * rad - rightAscension;

  const elevation = Math.asin(
    Math.sin(lat * rad) * Math.sin(declination) +
      Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle)
  );
  return elevation / rad;
}

/**
 * Dark, for a watch-keeping purpose.
 *
 * The threshold is the sun's upper limb on the horizon allowing for
 * refraction, which is the same instant an almanac calls sunset. Civil
 * twilight would be defensible too, but a crew changing a headsail at
 * nautical dusk is working in the dark whatever the definition says, and the
 * conservative line is the one that calls more of the passage night.
 */
const NIGHT_ELEVATION_DEG = -0.833;

export function isNightAt(lat: number, lon: number, timeMs: number): boolean {
  return solarElevationDeg(lat, lon, timeMs) < NIGHT_ELEVATION_DEG;
}

/**
 * How near the encounter period has to be to the boat's own roll period to
 * count as resonant. A boat rolls hardest when the sea arrives in step with
 * the roll it already has, and the response peak is broad rather than sharp.
 */
const RESONANCE_LOW = 0.8;
const RESONANCE_HIGH = 1.25;

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
/**
 * Conditions at the end of the passage, or null if it never got there.
 *
 * Taken from the last leg, which is the arrival itself — the router builds it
 * at the destination with the conditions it closed in.
 */
function landfallOf(route: RouteResult): PassageSummary['landfall'] {
  if (!route.reachedDestination) return null;
  const last = route.legs[route.legs.length - 1];
  if (!last) return null;
  return {
    atNight: isNightAt(last.lat, last.lon, Date.parse(last.time)),
    twsKts: last.twsKts,
    gustKts: last.gustKts,
    waveHeightM: last.waveHeightM,
    time: last.time
  };
}

export function summarisePassage(
  route: RouteResult,
  options: SummaryOptions = {}
): PassageSummary | null {
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
  const rollPeriodS =
    Number.isFinite(options.rollPeriodS) && (options.rollPeriodS as number) > 0
      ? (options.rollPeriodS as number)
      : null;
  let resonantHours = 0;
  let resonanceUnknownHours = 0;
  let nightHours = 0;
  let nightManoeuvres = 0;
  let windAgainstCurrentHours = 0;
  let currentKnownHours = 0;

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

    // Judged at the leg's own position and time, so a passage long enough to
    // change time zone gets its nights where they actually fall rather than
    // where the departure port's clock says.
    if (isNightAt(leg.lat, leg.lon, Date.parse(leg.time))) {
      nightHours += h;
      if (leg.manoeuvre) nightManoeuvres++;
    }

    if (leg.currentKts !== null) {
      currentKnownHours += h;
      if (leg.windAgainstCurrent) windAgainstCurrentHours += h;
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

      if (rollPeriodS !== null && leg.wavePeriodS !== null && leg.waveAngleDeg !== null) {
        const te = encounterPeriodS(leg.wavePeriodS, leg.waveAngleDeg, leg.boatSpeedKts);
        if (te === null) resonanceUnknownHours += h;
        else if (te >= rollPeriodS * RESONANCE_LOW && te <= rollPeriodS * RESONANCE_HIGH) {
          resonantHours += h;
        }
      }
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
    seaStateCoverage: round3(seaHours / hours),
    night: {
      fraction: round3(nightHours / hours),
      hours: Math.round(nightHours * 100) / 100,
      manoeuvres: nightManoeuvres
    },
    windAgainstCurrent:
      currentKnownHours > 0
        ? {
            fraction: round3(windAgainstCurrentHours / hours),
            hours: Math.round(windAgainstCurrentHours * 100) / 100
          }
        : null,
    landfall: landfallOf(route),
    rollResonance:
      rollPeriodS === null
        ? null
        : {
            fraction: round3(resonantHours / hours),
            hours: Math.round(resonantHours * 100) / 100,
            rollPeriodS,
            unknownHours: Math.round(resonanceUnknownHours * 100) / 100
          }
  };
}
