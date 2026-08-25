import { describe, it, expect } from 'vitest';
import { summarisePassage, WIND_BANDS_KTS, WAVE_BANDS_M } from '../src/passageSummary.js';
import { routeIsochrone, type RouteLeg, type RouteResult, type WindSampler } from '../src/routing.js';
import { GENERIC_POLARS } from '../src/polars.js';

const T0 = Date.UTC(2026, 7, 22, 0, 0, 0);

/**
 * A route built leg by leg, so a distribution can be checked against hours
 * that were put in on purpose. `hours` is how long each leg took; the first
 * leg is the departure point and always takes none.
 */
function routeOf(
  legs: Array<Partial<RouteLeg> & { hours: number }>
): RouteResult {
  let t = T0;
  const built: RouteLeg[] = legs.map((l, i) => {
    if (i > 0) t += l.hours * 3_600_000;
    return {
      lat: 40,
      lon: -70 + i,
      time: new Date(t).toISOString(),
      headingDeg: 90,
      twaDeg: l.twaDeg ?? 90,
      twsKts: l.twsKts ?? 15,
      gustKts: l.gustKts ?? null,
      boatSpeedKts: 6,
      distanceNm: 6 * l.hours,
      manoeuvre: null,
      motoring: l.motoring ?? false,
      waveHeightM: l.waveHeightM === undefined ? 1.5 : l.waveHeightM,
      waveAngleDeg: l.waveAngleDeg ?? 90,
      wavePeriodS: l.wavePeriodS ?? 8
    };
  });
  return {
    reachedDestination: true,
    legs: built,
    etaHours: (t - T0) / 3_600_000,
    distanceNm: 100,
    directDistanceNm: 90,
    warnings: [],
    polarName: 'test',
    maxWaveHeightM: 1.5,
    motoringHours: null,
    fuelLitres: null
  };
}

describe('summarisePassage', () => {
  it('has nothing to say about a passage that never left', () => {
    expect(summarisePassage(routeOf([{ hours: 0 }]))).toBeNull();
  });

  it('counts hours, not legs', () => {
    // Three hours of gale and one of breeze is not "half and half", which is
    // what counting legs would have said.
    const summary = summarisePassage(
      routeOf([
        { hours: 0 },
        { hours: 3, twsKts: 32 },
        { hours: 1, twsKts: 15 }
      ])
    )!;
    expect(summary.hours).toBe(4);
    const band = (from: number) => summary.windBands.find((b) => b.from === from)!;
    expect(band(30).fraction).toBeCloseTo(0.75, 6);
    expect(band(8).fraction).toBeCloseTo(0.25, 6);
  });

  it('weights the mean wind by time as well', () => {
    const summary = summarisePassage(
      routeOf([
        { hours: 0 },
        { hours: 9, twsKts: 10 },
        { hours: 1, twsKts: 30 }
      ])
    )!;
    // The mean of the legs would be 20; the mean of the passage is 12.
    expect(summary.wind.meanKts).toBeCloseTo(12, 6);
    expect(summary.wind.minKts).toBe(10);
    expect(summary.wind.maxKts).toBe(30);
  });

  it('splits the passage by point of sail', () => {
    const summary = summarisePassage(
      routeOf([
        { hours: 0 },
        { hours: 1, twaDeg: 40 },
        { hours: 5, twaDeg: 95 },
        { hours: 4, twaDeg: 150 }
      ])
    )!;
    expect(summary.pointOfSail.upwind).toBeCloseTo(0.1, 6);
    expect(summary.pointOfSail.reaching).toBeCloseTo(0.5, 6);
    expect(summary.pointOfSail.downwind).toBeCloseTo(0.4, 6);
    const total =
      summary.pointOfSail.upwind + summary.pointOfSail.reaching + summary.pointOfSail.downwind;
    expect(total).toBeCloseTo(1, 6);
  });

  it('finds the hours that are upwind AND windy, which neither distribution shows', () => {
    const summary = summarisePassage(
      routeOf([
        { hours: 0 },
        { hours: 2, twaDeg: 40, twsKts: 22 }, // hard on the wind in a breeze
        { hours: 2, twaDeg: 40, twsKts: 10 }, // upwind, but gentle
        { hours: 6, twaDeg: 140, twsKts: 22 } // windy, but downwind
      ])
    )!;
    expect(summary.pointOfSail.upwind).toBeCloseTo(0.4, 6);
    expect(summary.hardUpwind.fraction).toBeCloseTo(0.2, 6);
    expect(summary.hardUpwind.hours).toBeCloseTo(2, 6);
  });

  it('reports the worst gust and survives a model that published none', () => {
    const withGusts = summarisePassage(
      routeOf([
        { hours: 0 },
        { hours: 2, twsKts: 18, gustKts: 24 },
        { hours: 2, twsKts: 20, gustKts: 31.5 }
      ])
    )!;
    expect(withGusts.wind.maxGustKts).toBe(31.5);

    const without = summarisePassage(routeOf([{ hours: 0 }, { hours: 2, twsKts: 18 }]))!;
    expect(without.wind.maxGustKts).toBeNull();
  });

  it('leaves uncovered water out of the sea distribution and says how much', () => {
    const summary = summarisePassage(
      routeOf([
        { hours: 0 },
        { hours: 6, waveHeightM: 2.5 },
        { hours: 4, waveHeightM: null }
      ])
    )!;
    expect(summary.seaStateCoverage).toBeCloseTo(0.6, 6);
    // The 2.5 m band is all of the sea that WAS known, not 60% of it: a
    // distribution over partial coverage still has to add up.
    const band = summary.waveBands.find((b) => b.from === 2)!;
    expect(band.fraction).toBeCloseTo(1, 6);
    expect(band.hours).toBeCloseTo(6, 6);
    expect(summary.waveBands.reduce((s, b) => s + b.fraction, 0)).toBeCloseTo(1, 6);
  });

  it('says the sea was never covered rather than dividing by nothing', () => {
    const summary = summarisePassage(
      routeOf([{ hours: 0 }, { hours: 5, waveHeightM: null }])
    )!;
    expect(summary.seaStateCoverage).toBe(0);
    expect(summary.waveBands.every((b) => b.fraction === 0)).toBe(true);
  });

  it('labels bands the way they will be read', () => {
    const summary = summarisePassage(routeOf([{ hours: 0 }, { hours: 1 }]))!;
    expect(summary.windBands.map((b) => b.label)).toEqual([
      '<8kt',
      '8–20kt',
      '20–30kt',
      '30–40kt',
      '>40kt'
    ]);
    expect(summary.waveBands.map((b) => b.label)).toEqual(['<1m', '1–2m', '2–3m', '3–4m', '>4m']);
    expect(summary.windBands.map((b) => b.from)).toEqual(WIND_BANDS_KTS);
    expect(summary.waveBands.map((b) => b.from)).toEqual(WAVE_BANDS_M);
  });

  it('every distribution adds up on a real routed passage', () => {
    const wind: WindSampler = () => ({ speedKts: 18, directionDeg: 0, gustKts: 25 });
    const route = routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -66 },
      departure: T0,
      polar: GENERIC_POLARS.cruisingMonohull,
      wind,
      waves: () => ({ heightM: 1.8, directionDeg: 90, periodS: 7 })
    });
    const summary = summarisePassage(route)!;
    expect(summary.hours).toBeCloseTo(route.etaHours, 1);
    expect(summary.windBands.reduce((s, b) => s + b.fraction, 0)).toBeCloseTo(1, 6);
    expect(summary.wind.maxGustKts).toBe(25);
    expect(summary.seaStateCoverage).toBeCloseTo(1, 6);
    expect(summary.waveBands.find((b) => b.from === 1)!.fraction).toBeCloseTo(1, 6);
  });
});
