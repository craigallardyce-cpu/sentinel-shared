import { describe, it, expect } from 'vitest';
import { routeIsochrone, distanceNm, type WindSampler, type WaveSampler } from '../src/routing.js';
import { scanHazards, buildCorridor, buildAdvisory, compareToPlan } from '../src/corridor.js';
import { GENERIC_POLARS } from '../src/polars.js';

const T0 = Date.UTC(2026, 7, 22, 12, 0, 0);
const polar = GENERIC_POLARS.cruisingMonohull;

const steadyWind = (speedKts: number, directionDeg: number, gustKts?: number): WindSampler =>
  () => ({ speedKts, directionDeg, gustKts: gustKts ?? null });
const steadySea = (heightM: number): WaveSampler => () => ({ heightM, directionDeg: 90, periodS: 8 });

const START = { lat: 38, lon: -66 };
const DEST = { lat: 34, lon: -58 };

const route = (extra: Record<string, unknown> = {}) =>
  routeIsochrone({
    start: START,
    destination: DEST,
    departure: T0,
    polar,
    wind: steadyWind(15, 0),
    maxHours: 120,
    ...extra
  });

describe('retaining fronts', () => {
  it('costs nothing when nobody asks', () => {
    expect(route().fronts).toEqual([]);
  });

  it('records everywhere the boat could be, not just where it went', () => {
    const r = route({ retainFronts: true });
    expect(r.fronts.length).toBeGreaterThan(3);
    // A front is a set, not a point: the search reaches many places each hour.
    expect(Math.max(...r.fronts.map((f) => f.points.length))).toBeGreaterThan(5);
    // And it is wider than the route, which keeps one node per front.
    expect(r.fronts.reduce((n, f) => n + f.points.length, 0)).toBeGreaterThan(r.legs.length);
  });

  it('thins the fronts when asked, without changing the route', () => {
    const every = route({ retainFronts: true });
    const sixth = route({ retainFronts: true, frontIntervalSteps: 6 });
    expect(sixth.fronts.length).toBeLessThan(every.fronts.length);
    expect(sixth.etaHours).toBe(every.etaHours);
  });

  it('stamps each front with how far into the passage it is', () => {
    const r = route({ retainFronts: true });
    const hours = r.fronts.map((f) => f.hoursFromDeparture);
    expect(hours[0]).toBeGreaterThan(0);
    // Monotonic, and matching the timestamps they carry.
    for (let i = 1; i < hours.length; i++) expect(hours[i]).toBeGreaterThan(hours[i - 1]);
    expect(r.fronts[0].timeMs).toBeGreaterThan(T0);
  });
});

describe('buildCorridor', () => {
  it('has nothing to say about a route with no fronts', () => {
    const c = buildCorridor({ ...route(), reachedDestination: false, fronts: [] }, DEST);
    expect(c.bands).toEqual([]);
    expect(c.pinch).toBeNull();
    expect(c.widest).toBeNull();
  });

  it('measures how much water the boat has, hour by hour', () => {
    const c = buildCorridor(route({ retainFronts: true, frontIntervalSteps: 4 }), DEST);
    expect(c.bands.length).toBeGreaterThan(2);
    expect(c.widest!.widthNm).toBeGreaterThan(0);
    // Every band's width is a real separation between two of its own points.
    for (const band of c.bands) {
      expect(band.points.length).toBeGreaterThanOrEqual(2);
      expect(band.widthNm).toBeGreaterThan(0);
    }
  });

  it('finds no decision to report in open water', () => {
    // Steady wind, no sea limit: nothing is taking the boat's options away, so
    // claiming a pinch would be inventing one.
    const c = buildCorridor(route({ retainFronts: true, frontIntervalSteps: 4 }), DEST);
    expect(c.pinch).toBeNull();
  });

  it('narrows where the weather takes the options away', () => {
    // A patch of gale seas ON the rhumb line, with calm water round it and a
    // sea limit that refuses it — so the boat goes around and still arrives.
    // An earlier version of this fixture was a band spanning every longitude,
    // which is a wall rather than an obstacle: nothing got through, and the
    // corridor was empty for the honest reason that there was no passage.
    const patch: WaveSampler = (lat, lon) => ({
      heightM: Math.hypot(lat - 36, lon + 62) < 0.8 ? 6 : 0.5,
      directionDeg: 90,
      periodS: 8
    });
    const r = route({
      retainFronts: true,
      frontIntervalSteps: 3,
      waves: patch,
      maxWaveHeightM: 3,
      maxHours: 160
    });
    expect(r.reachedDestination).toBe(true);
    const c = buildCorridor(r, DEST);
    expect(c.bands.length).toBeGreaterThan(2);
    // Some water was carved out: at least one front lost points to the gale.
    const carved = r.fronts.some((f) => f.points.some((p) => !p.clear));
    expect(carved).toBe(true);
  });

  it('never calls the start or the finish a decision', () => {
    // A passage begins and ends at a point, so those fronts are narrow for a
    // reason that has nothing to do with the weather.
    const c = buildCorridor(route({ retainFronts: true, frontIntervalSteps: 4 }), DEST);
    if (c.pinch) {
      expect(c.pinch).not.toBe(c.bands[0]);
      expect(c.pinch).not.toBe(c.bands[c.bands.length - 1]);
    }
  });
});

describe('scanHazards', () => {
  const calm = { wind: steadyWind(14, 0), waves: steadySea(1) };
  const gale = { wind: steadyWind(38, 0, 48), waves: steadySea(5) };

  it('finds nothing in a quiet forecast', () => {
    const scan = scanHazards(route(), calm);
    expect(scan.hazards).toEqual([]);
    expect(scan.worst).toBeNull();
    expect(scan.soonest).toBeNull();
  });

  it('reports what breaks, and by how much', () => {
    const scan = scanHazards(route(), gale);
    expect(scan.hazards.length).toBeGreaterThan(0);
    const kinds = scan.worst!.breaches.map((b) => b.kind);
    expect(kinds).toContain('wind');
    expect(kinds).toContain('gust');
    expect(kinds).toContain('sea');
    expect(scan.worst!.breaches.find((b) => b.kind === 'wind')!.value).toBeCloseTo(38, 1);
  });

  it('respects the crew’s own limits', () => {
    const moderate = { wind: steadyWind(26, 0), waves: steadySea(1) };
    expect(scanHazards(route(), moderate).hazards).toEqual([]);
    expect(scanHazards(route(), moderate, { limits: { windKts: 22 } }).hazards.length).toBeGreaterThan(0);
  });

  it('says nothing is new when there is nothing to compare against', () => {
    const scan = scanHazards(route(), gale);
    expect(scan.comparedToPlan).toBe(false);
    expect(scan.hazards.every((h) => !h.isNew)).toBe(true);
  });

  it('knows a gale that was already in the plan from one that was not', () => {
    const knownAtDeparture = scanHazards(route(), gale, { plannedWith: gale });
    expect(knownAtDeparture.comparedToPlan).toBe(true);
    expect(knownAtDeparture.hazards.every((h) => !h.isNew)).toBe(true);

    const appearedSince = scanHazards(route(), gale, { plannedWith: calm });
    expect(appearedSince.hazards.length).toBeGreaterThan(0);
    expect(appearedSince.hazards.every((h) => h.isNew)).toBe(true);
  });

  it('does not call a breach new when the old forecast was already at the edge', () => {
    // Two grids fetched minutes apart disagree in the third decimal. A sea of
    // 3.99 m against a 4 m limit that is now 4.01 m has not "appeared since
    // departure" — the number moved by a centimetre, and an advisory that
    // cries wolf on that gets muted before the real gale arrives.
    const edge = { wind: steadyWind(14, 0), waves: steadySea(3.99) };
    const over = { wind: steadyWind(14, 0), waves: steadySea(4.01) };
    const scan = scanHazards(route(), over, { plannedWith: edge });
    expect(scan.hazards.length).toBeGreaterThan(0);
    expect(scan.hazards.every((h) => !h.isNew)).toBe(true);

    // A sea that really was calm before is still reported as new.
    const calmBefore = { wind: steadyWind(14, 0), waves: steadySea(1) };
    const genuinely = scanHazards(route(), over, { plannedWith: calmBefore });
    expect(genuinely.hazards.every((h) => h.isNew)).toBe(true);
  });

  it('reports how far ahead the trouble is', () => {
    const scan = scanHazards(route(), gale, { now: T0 });
    expect(scan.soonest!.hoursAway).toBeGreaterThanOrEqual(0);
    expect(scan.soonest!.hoursAway).toBeLessThanOrEqual(scan.worst!.hoursAway + 0.001);
  });
});

describe('buildAdvisory', () => {
  const calm = { wind: steadyWind(14, 0), waves: steadySea(1) };

  it('leads with what was not in the plan, even when something else is worse', () => {
    // A savage sea everywhere — known at departure — and a new gust hazard.
    // The known one is more severe; the new one still leads, because it is the
    // only one nobody has decided about.
    const now: WaveSampler = () => ({ heightM: 9, directionDeg: 90, periodS: 8 });
    const samplers = { wind: steadyWind(20, 0, 44), waves: now };
    const planned = { wind: steadyWind(20, 0, 20), waves: now };

    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    const scan = scanHazards(r, samplers, { plannedWith: planned });
    const advisory = buildAdvisory(r, scan, buildCorridor(r, DEST), null);

    expect(advisory.headlineIsNew).toBe(true);
    // The gusts are new; the sea was always going to be like that, and the
    // advisory has to be able to tell them apart on the same position.
    const gust = advisory.headline!.breaches.find((b) => b.kind === 'gust')!;
    const sea = advisory.headline!.breaches.find((b) => b.kind === 'sea')!;
    expect(gust.isNew).toBe(true);
    expect(sea.isNew).toBe(false);
  });

  it('falls back to the worst known hazard when nothing is new', () => {
    const gale = { wind: steadyWind(36, 0), waves: steadySea(1) };
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    const scan = scanHazards(r, gale, { plannedWith: gale });
    const advisory = buildAdvisory(r, scan, buildCorridor(r, DEST), null);
    expect(advisory.headline).not.toBeNull();
    expect(advisory.headlineIsNew).toBe(false);
  });

  it('has no headline for a passage with nothing wrong with it', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    const advisory = buildAdvisory(r, scanHazards(r, calm), buildCorridor(r, DEST), null);
    expect(advisory.headline).toBeNull();
    expect(advisory.headlineIsNew).toBe(false);
  });

  it('says what the diversion costs against the plan as filed', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    const advisory = buildAdvisory(r, scanHazards(r, calm), buildCorridor(r, DEST), r.etaHours - 9);
    expect(advisory.costHours).toBeCloseTo(9, 1);
  });

  it('reports no cost when there is no filed plan to compare against', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    expect(buildAdvisory(r, scanHazards(r, calm), buildCorridor(r, DEST), null).costHours).toBeNull();
  });
});

describe('compareToPlan', () => {
  const at = (hoursFromT0: number, windKts: number | null, waveM: number | null) => ({
    lat: 37,
    lon: -62,
    time: new Date(T0 + hoursFromT0 * 3600_000).toISOString(),
    windKts,
    gustKts: null,
    waveM
  });

  it('says a passage is tracking when the forecast has barely moved', () => {
    const cps = [at(6, 18, 2), at(18, 20, 2.2), at(30, 16, 1.8)];
    const c = compareToPlan(cps, { wind: steadyWind(19, 0), waves: steadySea(2.1) }, { now: T0 });
    expect(c.segments).toHaveLength(3);
    expect(c.verdict).toBe('tracking');
    expect(c.divergesAt).toBeNull();
    expect(c.trackingFraction).toBe(1);
  });

  it('calls it worsening when the wind has got up beyond the noise', () => {
    const cps = [at(6, 18, 2), at(18, 18, 2)];
    const c = compareToPlan(cps, { wind: steadyWind(32, 0), waves: steadySea(2) }, { now: T0 });
    expect(c.verdict).toBe('worsening');
    expect(c.segments[0].windDeltaKts).toBeCloseTo(14, 1);
    // The FIRST divergence, not the worst: it is the one there is still time
    // to do something about.
    expect(c.divergesAt!.hoursAway).toBeCloseTo(6, 1);
  });

  it('calls it easing when both have dropped', () => {
    const cps = [at(6, 30, 4), at(18, 30, 4)];
    const c = compareToPlan(cps, { wind: steadyWind(18, 0), waves: steadySea(1.5) }, { now: T0 });
    expect(c.verdict).toBe('easing');
  });

  it('will not call a knot of grid noise a change', () => {
    const cps = [at(6, 18, 2)];
    const c = compareToPlan(cps, { wind: steadyWind(20, 0), waves: steadySea(2.3) }, { now: T0 });
    expect(c.verdict).toBe('tracking');
  });

  it('reports worse where the wind eased but the sea got up', () => {
    // Not "mixed". A crew needs to hear the worse half.
    const cps = [at(6, 30, 2)];
    const c = compareToPlan(cps, { wind: steadyWind(20, 0), waves: steadySea(3.5) }, { now: T0 });
    expect(c.verdict).toBe('worsening');
  });

  it('ignores the part of the passage already sailed', () => {
    // Telling somebody yesterday diverged is telling them about a decision
    // they can no longer make.
    const cps = [at(-24, 18, 2), at(-6, 18, 2), at(12, 18, 2)];
    const c = compareToPlan(cps, { wind: steadyWind(19, 0), waves: steadySea(2) }, { now: T0 });
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0].hoursAway).toBeCloseTo(12, 1);
  });

  it('says unknown rather than guessing where the forecast does not reach', () => {
    const cps = [at(6, 18, 2)];
    const c = compareToPlan(cps, { wind: () => null }, { now: T0 });
    expect(c.segments[0].verdict).toBe('unknown');
    expect(c.verdict).toBe('unknown');
    expect(c.trackingFraction).toBe(0);
  });

  it('has nothing to compare when the plan carried no expectations', () => {
    const cps = [at(6, null, null)];
    const c = compareToPlan(cps, { wind: steadyWind(20, 0), waves: steadySea(2) }, { now: T0 });
    expect(c.segments[0].verdict).toBe('unknown');
  });
});

describe('the corridor is not the reachable set', () => {
  /**
   * The bug this guards against was visible the moment somebody looked at the
   * chart: the corridor was drawn from every position the boat could reach,
   * which on an ocean passage fans out across the whole area and reads as
   * scattered blobs. Reachability is not the question — which water still gets
   * you there in about the best time is.
   */
  it('keeps far less than the search could reach', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 3 });
    const reachable = r.fronts.reduce((n, f) => n + f.points.filter((p) => p.clear).length, 0);
    const inCorridor = buildCorridor(r, DEST).bands.reduce((n, b) => n + b.points.length, 0);
    expect(reachable).toBeGreaterThan(0);
    expect(inCorridor).toBeLessThan(reachable);
  });

  it('keeps the water near the route and drops the water behind the fan', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 3 });
    const c = buildCorridor(r, DEST);
    // Every retained position must still be able to make the passage within
    // the tolerance, judged the same way the corridor judges it.
    const slackFor = (baseline) => 0.1 * baseline;
    for (const band of c.bands) {
      // How far along the best route was at this hour.
      const closest = r.legs.reduce((a, b) =>
        Math.abs(Date.parse(a.time) - band.timeMs) <= Math.abs(Date.parse(b.time) - band.timeMs) ? a : b
      );
      const baseline = distanceNm(closest.lat, closest.lon, DEST.lat, DEST.lon);
      for (const pt of band.points) {
        expect(distanceNm(pt.lat, pt.lon, DEST.lat, DEST.lon))
          .toBeLessThanOrEqual(baseline + slackFor(baseline) + 1e-6);
      }
    }
  });

  it('widens when the tolerance is loosened', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 3 });
    const tight = buildCorridor(r, DEST, { toleranceFraction: 0.02 });
    const loose = buildCorridor(r, DEST, { toleranceFraction: 0.35 });
    const count = (c) => c.bands.reduce((n, b) => n + b.points.length, 0);
    expect(count(loose)).toBeGreaterThan(count(tight));
  });

  it('draws nothing for a passage that never arrived', () => {
    // No best time to be near, so a corridor would be a confident shape around
    // a route that failed.
    const stalled = routeIsochrone({
      start: START,
      destination: { lat: 34, lon: -20 },
      departure: T0,
      polar,
      wind: steadyWind(12, 90),
      maxHours: 8,
      retainFronts: true
    });
    expect(stalled.reachedDestination).toBe(false);
    expect(buildCorridor(stalled, { lat: 34, lon: -20 }).bands).toEqual([]);
  });
});

describe('the corridor closes on the destination', () => {
  /**
   * Spotted by looking at the chart: the bands fanned out and stayed fanned,
   * ending as a blob tens of miles across around the arrival rather than
   * converging on it. The cause was a slack held constant in nautical miles —
   * near the destination the best route's remaining distance goes to zero
   * while a fixed allowance does not, and there is no time left in which to
   * make up that distance, so the width was a claim that was not true.
   */
  it('is narrow at the end, and much wider in the middle', () => {
    const r = routeIsochrone({
      start: START,
      destination: DEST,
      departure: T0,
      polar,
      wind: steadyWind(14, 20),
      retainFronts: true,
      frontIntervalSteps: 6,
      maxHours: 200
    });
    expect(r.reachedDestination).toBe(true);
    const bands = buildCorridor(r, DEST).bands;
    expect(bands.length).toBeGreaterThan(4);

    const last = bands[bands.length - 1];
    const widest = bands.reduce((a, b) => (a.widthNm >= b.widthNm ? a : b));
    // The final band is a small fraction of the widest — the passage has to
    // end AT the destination, so the water that still gets there closes on it.
    expect(last.widthNm).toBeLessThan(widest.widthNm * 0.25);
    // And the widest is genuinely in the middle, not at either end.
    expect(widest).not.toBe(bands[0]);
    expect(widest).not.toBe(last);
  });

  it('narrows monotonically over the second half of the passage', () => {
    const r = routeIsochrone({
      start: START,
      destination: DEST,
      departure: T0,
      polar,
      wind: steadyWind(14, 20),
      retainFronts: true,
      frontIntervalSteps: 6,
      maxHours: 200
    });
    const bands = buildCorridor(r, DEST).bands;
    const widestAt = bands.indexOf(bands.reduce((a, b) => (a.widthNm >= b.widthNm ? a : b)));
    for (let i = widestAt + 1; i < bands.length; i++) {
      expect(bands[i].widthNm).toBeLessThanOrEqual(bands[i - 1].widthNm + 1e-6);
    }
  });
});

describe('legs know which way the wind is blowing', () => {
  /**
   * `twaDeg` is folded into 0-180, so the side is gone and the wind direction
   * cannot be recovered from a leg. Anything drawing wind on a chart — barbs
   * along a passage, for instance — needs the direction itself.
   */
  it('records the wind direction, not only the angle to the boat', () => {
    const r = routeIsochrone({
      start: START,
      destination: DEST,
      departure: T0,
      polar,
      wind: steadyWind(18, 215)
    });
    const sailing = r.legs.filter((l) => l.twsKts > 0);
    expect(sailing.length).toBeGreaterThan(0);
    for (const leg of sailing) expect(leg.windFromDeg).toBeCloseTo(215, 0);
  });

  it('reports the wind the sails feel, so a current shifts it', () => {
    const base = { start: START, destination: DEST, departure: T0, polar, wind: steadyWind(14, 0) };
    const still = routeIsochrone(base);
    const inStream = routeIsochrone({ ...base, currents: () => ({ speedKts: 3, setDeg: 90 }) });
    expect(inStream.legs[1].windFromDeg).not.toBeCloseTo(still.legs[1].windFromDeg, 1);
  });
});
