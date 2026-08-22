import { boatSpeed, foldTwa, type PolarDiagram } from './polars.js';

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
 *   - THERE IS NO LAND AVOIDANCE. Nothing here knows where the coast is, so a
 *     route may cross a headland, an island, or a traffic separation scheme.
 *     Every result says so in `warnings`, and callers must present it as a
 *     weather plan to lay over a chart, never as a course to steer.
 *   - No currents, no waves, no leeway. Wind and polar only.
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
}

/** Wind at a place and moment, or null where the forecast does not reach. */
export type WindSampler = (lat: number, lon: number, timeMs: number) => WindSample | null;

export interface RouteLeg {
  lat: number;
  lon: number;
  /** ISO time of arrival at this point. */
  time: string;
  headingDeg: number;
  twaDeg: number;
  twsKts: number;
  boatSpeedKts: number;
  distanceNm: number;
  /** True where the boat changes tack or gybe relative to the previous leg. */
  manoeuvre: 'tack' | 'gybe' | null;
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
   * Ignore headings more than this far off the bearing to the destination.
   * Wide enough for upwind tacking; narrow enough to stop the search sailing
   * away from where it is going. Default 110°.
   */
  maxOffCourseDeg?: number;
}

interface Node {
  lat: number;
  lon: number;
  timeMs: number;
  parent: Node | null;
  headingDeg: number;
  twaDeg: number;
  twsKts: number;
  boatSpeedKts: number;
  distanceNm: number;
  /** Sign of the wind angle: -1 port, +1 starboard, 0 head/dead down. */
  tackSide: number;
}

const NO_LAND_WARNING =
  'This route is computed from wind and boat polar only. It does not know where land, ' +
  'shallows, or traffic schemes are — check every leg against your chart before sailing it.';

function relativeSide(headingDeg: number, windFromDeg: number): number {
  const delta = ((headingDeg - windFromDeg + 540) % 360) - 180;
  if (Math.abs(delta) < 1e-6 || Math.abs(Math.abs(delta) - 180) < 1e-6) return 0;
  return delta > 0 ? 1 : -1;
}

function buildLegs(node: Node, polarName: string): RouteLeg[] {
  const chain: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) chain.push(n);
  chain.reverse();

  const legs: RouteLeg[] = [];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    const prev = i > 0 ? chain[i - 1] : null;
    let manoeuvre: 'tack' | 'gybe' | null = null;
    if (prev && prev.tackSide !== 0 && n.tackSide !== 0 && prev.tackSide !== n.tackSide) {
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
      boatSpeedKts: Math.round(n.boatSpeedKts * 100) / 100,
      distanceNm: Math.round(n.distanceNm * 100) / 100,
      manoeuvre
    });
  }
  return legs;
}

function totalDistance(legs: RouteLeg[]): number {
  return Math.round(legs.reduce((sum, l) => sum + l.distanceNm, 0) * 100) / 100;
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
    manoeuvrePenaltyMinutes = 2
  } = options;

  const warnings: string[] = [NO_LAND_WARNING];
  if (polar.generic) {
    warnings.push(
      `Timings come from a generic polar (${polar.name}), not this boat's measured performance — ` +
        'treat the ETA as a comparison between departure times, not a promise.'
    );
  }

  if (polar.note) warnings.push(polar.note);

  const directDistanceNm = distanceNm(start.lat, start.lon, destination.lat, destination.lon);
  const stepHours = stepMinutes / 60;
  const maxSteps = Math.max(1, Math.floor(maxHours / stepHours));

  const root: Node = {
    lat: start.lat,
    lon: start.lon,
    timeMs: departure,
    parent: null,
    headingDeg: bearingDeg(start.lat, start.lon, destination.lat, destination.lon),
    twaDeg: 0,
    twsKts: 0,
    boatSpeedKts: 0,
    distanceNm: 0,
    tackSide: 0
  };

  let frontier: Node[] = [root];
  let best: Node = root;
  let bestRemaining = directDistanceNm;

  for (let step = 0; step < maxSteps; step++) {
    const nextTime = departure + (step + 1) * stepMinutes * 60_000;
    const candidates: Node[] = [];

    for (const node of frontier) {
      const sample = wind(node.lat, node.lon, node.timeMs);
      if (!sample || !Number.isFinite(sample.speedKts)) continue;

      const toDestination = bearingDeg(node.lat, node.lon, destination.lat, destination.lon);
      const remaining = distanceNm(node.lat, node.lon, destination.lat, destination.lon);

      // Final approach. Closing speed is velocity made good toward the
      // destination, not boat speed: the last miles are often dead upwind, and
      // a boat that must tack them still arrives — just later. Testing only a
      // heading that points straight at the destination would strand the search
      // a mile off a windward landfall, sailing in circles until it timed out.
      let closingVmg = 0;
      let closingHeading = toDestination;
      let closingTwa = angleBetween(toDestination, sample.directionDeg);
      for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
        const twa = angleBetween(heading, sample.directionDeg);
        const speed = boatSpeed(polar, twa, sample.speedKts);
        if (speed <= 0) continue;
        const vmg = speed * Math.cos(toRad(angleBetween(heading, toDestination)));
        if (vmg > closingVmg) {
          closingVmg = vmg;
          closingHeading = heading;
          closingTwa = twa;
        }
      }

      if (closingVmg > 0 && remaining <= closingVmg * stepHours) {
        const arrivalMs = node.timeMs + (remaining / closingVmg) * 3_600_000;
        const arrival: Node = {
          lat: destination.lat,
          lon: destination.lon,
          timeMs: arrivalMs,
          parent: node,
          headingDeg: closingHeading,
          twaDeg: closingTwa,
          twsKts: sample.speedKts,
          boatSpeedKts: boatSpeed(polar, closingTwa, sample.speedKts),
          distanceNm: remaining,
          tackSide: relativeSide(closingHeading, sample.directionDeg)
        };
        const legs = buildLegs(arrival, polar.name);
        return {
          reachedDestination: true,
          legs,
          etaHours: Math.round(((arrivalMs - departure) / 3_600_000) * 100) / 100,
          distanceNm: totalDistance(legs),
          directDistanceNm: Math.round(directDistanceNm * 100) / 100,
          warnings,
          polarName: polar.name
        };
      }

      for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
        if (angleBetween(heading, toDestination) > maxOffCourseDeg) continue;

        const twa = angleBetween(heading, sample.directionDeg);
        const speed = boatSpeed(polar, twa, sample.speedKts);
        if (speed <= 0) continue;

        // A manoeuvre eats into the step: the boat is slow through the turn and
        // the crew is busy, so the same hour covers less ground.
        const side = relativeSide(heading, sample.directionDeg);
        const manoeuvring = node.tackSide !== 0 && side !== 0 && side !== node.tackSide;
        const usableHours = manoeuvring
          ? Math.max(0, stepHours - manoeuvrePenaltyMinutes / 60)
          : stepHours;
        const legDistance = speed * usableHours;
        if (legDistance <= 0) continue;
        const point = destinationPoint(node.lat, node.lon, heading, legDistance);
        candidates.push({
          lat: point.lat,
          lon: point.lon,
          timeMs: nextTime,
          parent: node,
          headingDeg: heading,
          twaDeg: twa,
          twsKts: sample.speedKts,
          boatSpeedKts: speed,
          distanceNm: legDistance,
          tackSide: side
        });
      }
    }

    if (!candidates.length) {
      warnings.push(
        step === 0
          ? 'No forecast wind at the departure point and time, so no route could be started.'
          : 'The route stalled: no usable wind was forecast ahead of the last position reached.'
      );
      break;
    }

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

  if (!warnings.some((w) => w.startsWith('The route stalled') || w.startsWith('No forecast wind'))) {
    warnings.push(
      `The destination was not reached within ${maxHours} hours; this is the best progress found.`
    );
  }

  const legs = buildLegs(best, polar.name);
  return {
    reachedDestination: false,
    legs,
    etaHours: Math.round(((best.timeMs - departure) / 3_600_000) * 100) / 100,
    distanceNm: totalDistance(legs),
    directDistanceNm: Math.round(directDistanceNm * 100) / 100,
    warnings,
    polarName: polar.name
  };
}
