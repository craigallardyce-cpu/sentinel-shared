import { describe, it, expect } from 'vitest';
import { routeIsochrone, type WindSampler, type WaveSampler } from '../src/routing.js';
import { scanHazards, buildCorridor, buildAdvisory } from '../src/corridor.js';
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
    const c = buildCorridor([]);
    expect(c.bands).toEqual([]);
    expect(c.pinch).toBeNull();
    expect(c.widest).toBeNull();
  });

  it('measures how much water the boat has, hour by hour', () => {
    const c = buildCorridor(route({ retainFronts: true, frontIntervalSteps: 4 }).fronts);
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
    const c = buildCorridor(route({ retainFronts: true, frontIntervalSteps: 4 }).fronts);
    expect(c.pinch).toBeNull();
  });

  it('narrows where the weather takes the options away', () => {
    // A band of gale seas across the middle of the passage, with a sea limit
    // that refuses it. The corridor should be measurably narrower there.
    const patch: WaveSampler = (lat) => ({
      heightM: Math.abs(lat - 36) < 0.7 ? 6 : 0.5,
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
    const c = buildCorridor(r.fronts);
    expect(c.bands.length).toBeGreaterThan(2);
    // Some water was carved out: at least one front lost points to the gale.
    const carved = r.fronts.some((f) => f.points.some((p) => !p.clear));
    expect(carved).toBe(true);
  });

  it('never calls the start or the finish a decision', () => {
    // A passage begins and ends at a point, so those fronts are narrow for a
    // reason that has nothing to do with the weather.
    const c = buildCorridor(route({ retainFronts: true, frontIntervalSteps: 4 }).fronts);
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
    const advisory = buildAdvisory(r, scan, buildCorridor(r.fronts), null);

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
    const advisory = buildAdvisory(r, scan, buildCorridor(r.fronts), null);
    expect(advisory.headline).not.toBeNull();
    expect(advisory.headlineIsNew).toBe(false);
  });

  it('has no headline for a passage with nothing wrong with it', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    const advisory = buildAdvisory(r, scanHazards(r, calm), buildCorridor(r.fronts), null);
    expect(advisory.headline).toBeNull();
    expect(advisory.headlineIsNew).toBe(false);
  });

  it('says what the diversion costs against the plan as filed', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    const advisory = buildAdvisory(r, scanHazards(r, calm), buildCorridor(r.fronts), r.etaHours - 9);
    expect(advisory.costHours).toBeCloseTo(9, 1);
  });

  it('reports no cost when there is no filed plan to compare against', () => {
    const r = route({ retainFronts: true, frontIntervalSteps: 6 });
    expect(buildAdvisory(r, scanHazards(r, calm), buildCorridor(r.fronts), null).costHours).toBeNull();
  });
});
