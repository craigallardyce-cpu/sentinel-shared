import { describe, it, expect } from 'vitest';
import { routeIsochrone, seaStateFactor, type WindSampler, type WaveSampler } from '../src/routing.js';
import { summarisePassage, encounterPeriodS } from '../src/passageSummary.js';
import { GENERIC_POLARS } from '../src/polars.js';

const T0 = Date.UTC(2026, 7, 22, 0, 0, 0);
const polar = GENERIC_POLARS.cruisingMonohull;

const steadyWind = (speedKts: number, directionDeg: number): WindSampler => () => ({
  speedKts,
  directionDeg
});
const steadySea = (heightM: number, directionDeg: number, periodS: number | null = 8): WaveSampler =>
  () => ({ heightM, directionDeg, periodS });

describe('wave period in the speed penalty', () => {
  it('charges a short steep sea more than a long swell of the same height', () => {
    const steep = seaStateFactor(2, 0, 5);
    const ordinary = seaStateFactor(2, 0, 8);
    const swell = seaStateFactor(2, 0, 12);
    expect(steep).toBeLessThan(ordinary);
    expect(ordinary).toBeLessThan(swell);
    // Roughly 20% / 10% / 5% of speed gone, on the bow.
    expect(1 - steep).toBeCloseTo(0.2, 2);
    expect(1 - ordinary).toBeCloseTo(0.1, 2);
    expect(1 - swell).toBeCloseTo(0.05, 3); // the clamp, doing its job
  });

  it('leaves the calibration exactly where it was at the reference period', () => {
    // The height-and-angle answer this gave before period existed.
    expect(seaStateFactor(2, 0, 8)).toBeCloseTo(seaStateFactor(2, 0, null), 12);
    expect(seaStateFactor(3, 45, 8)).toBeCloseTo(seaStateFactor(3, 45, null), 12);
  });

  it('falls back unchanged when the model gave no period', () => {
    expect(seaStateFactor(2.5, 30, null)).toBeCloseTo(1 - 0.3 * 6.25 * (0.1 + 0.9 * ((1 + Math.cos(Math.PI / 6)) / 2) ** 1.5) / 12, 10);
  });

  it('refuses to let a very short or very long period run away with it', () => {
    // Inverse square would charge a 3-second chop seven times over.
    expect(seaStateFactor(1, 0, 3)).toBeCloseTo(seaStateFactor(1, 0, 4), 6);
    expect(seaStateFactor(1, 0, 20)).toBeCloseTo(seaStateFactor(1, 0, 11.32), 3);
  });

  it('slows a real route down more in a steep sea than a long one', () => {
    const base = {
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -66 },
      departure: T0,
      polar,
      wind: steadyWind(16, 0)
    };
    const steep = routeIsochrone({ ...base, waves: steadySea(2.5, 90, 5) });
    const swell = routeIsochrone({ ...base, waves: steadySea(2.5, 90, 13) });
    expect(steep.reachedDestination).toBe(true);
    expect(swell.reachedDestination).toBe(true);
    expect(steep.etaHours).toBeGreaterThan(swell.etaHours);
  });
});

describe('motoring', () => {
  const base = {
    start: { lat: 40, lon: -70 },
    destination: { lat: 40, lon: -66 },
    departure: T0,
    polar
  };

  it('reports nothing about an engine that was not offered', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(16, 0) });
    expect(route.motoringHours).toBeNull();
    expect(route.fuelLitres).toBeNull();
    expect(route.legs.every((l) => !l.motoring)).toBe(true);
  });

  it('gets a becalmed boat home instead of stalling it', () => {
    const calm = steadyWind(0, 0);
    const sailing = routeIsochrone({ ...base, wind: calm, maxHours: 96 });
    expect(sailing.reachedDestination).toBe(false);

    const motoring = routeIsochrone({
      ...base,
      wind: calm,
      maxHours: 96,
      motoring: { speedKts: 6, enduranceHours: 60, fuelLitresPerHour: 2.5 }
    });
    expect(motoring.reachedDestination).toBe(true);
    expect(motoring.motoringHours).toBeGreaterThan(0);
    expect(motoring.fuelLitres).toBeCloseTo(motoring.motoringHours! * 2.5, 1);
  });

  it('leaves the engine off when the boat is sailing well', () => {
    const route = routeIsochrone({
      ...base,
      wind: steadyWind(18, 0),
      motoring: { speedKts: 6, enduranceHours: 60 }
    });
    expect(route.reachedDestination).toBe(true);
    expect(route.motoringHours).toBe(0);
    expect(route.fuelLitres).toBeNull();
  });

  it('does not motor straight upwind past the boats that are sailing', () => {
    // Dead upwind, blowing hard enough to sail. The engine is a floor under the
    // polar, not a shortcut around it, so a beat stays a beat.
    const beating = routeIsochrone({
      ...base,
      wind: steadyWind(16, 90),
      motoring: { speedKts: 6, enduranceHours: 200 }
    });
    expect(beating.reachedDestination).toBe(true);
    expect(beating.motoringHours).toBe(0);
    // It tacked rather than motoring the rhumb line.
    expect(beating.distanceNm).toBeGreaterThan(beating.directDistanceNm * 1.1);
  });

  it('stops motoring when the fuel runs out', () => {
    const route = routeIsochrone({
      ...base,
      wind: steadyWind(0, 0),
      maxHours: 120,
      motoring: { speedKts: 6, enduranceHours: 5, fuelLitresPerHour: 2 }
    });
    expect(route.motoringHours).toBeLessThanOrEqual(5.001);
    // Out of fuel in a calm, it is a sailing boat with no wind again.
    expect(route.reachedDestination).toBe(false);
  });

  it('says so when a route plans away almost the whole tank', () => {
    const route = routeIsochrone({
      ...base,
      wind: steadyWind(0, 0),
      maxHours: 96,
      // ~31 engine hours of passage against 34 aboard: it gets there, barely.
      motoring: { speedKts: 6, enduranceHours: 34, fuelLitresPerHour: 2.5 }
    });
    expect(route.reachedDestination).toBe(true);
    expect(route.warnings.some((w) => w.includes('next to nothing in the tank'))).toBe(true);
  });

  it('slows the engine down in a sea, like the sails', () => {
    const flat = routeIsochrone({
      ...base,
      wind: steadyWind(0, 0),
      maxHours: 96,
      waves: steadySea(0.1, 90),
      motoring: { speedKts: 6, enduranceHours: 80 }
    });
    const rough = routeIsochrone({
      ...base,
      wind: steadyWind(0, 0),
      maxHours: 96,
      waves: steadySea(3, 90, 6),
      motoring: { speedKts: 6, enduranceHours: 80 }
    });
    expect(flat.reachedDestination).toBe(true);
    expect(rough.reachedDestination).toBe(true);
    expect(rough.etaHours).toBeGreaterThan(flat.etaHours);
  });

  it('counts motoring hours off the legs that were actually under power', () => {
    const route = routeIsochrone({
      ...base,
      wind: steadyWind(0, 0),
      maxHours: 96,
      motoring: { speedKts: 6, enduranceHours: 80, fuelLitresPerHour: 3 }
    });
    const underPower = route.legs.filter((l) => l.motoring);
    expect(underPower.length).toBeGreaterThan(0);
    expect(route.motoringHours).toBeGreaterThan(0);
    expect(route.motoringHours).toBeLessThanOrEqual(route.etaHours + 0.001);
  });
});

describe('encounterPeriodS', () => {
  it('shortens the period in a head sea and lengthens it in a following one', () => {
    const head = encounterPeriodS(8, 0, 6)!;
    const following = encounterPeriodS(8, 180, 6)!;
    expect(head).toBeLessThan(8);
    expect(following).toBeGreaterThan(8);
  });

  it('is the wave period itself for a boat standing still', () => {
    expect(encounterPeriodS(9, 0, 0)).toBeCloseTo(9, 6);
    expect(encounterPeriodS(9, 180, 0)).toBeCloseTo(9, 6);
  });

  it('is unchanged on the beam, where the boat closes nothing', () => {
    expect(encounterPeriodS(8, 90, 7)).toBeCloseTo(8, 6);
  });

  it('says nothing rather than a nonsense number when running with the sea', () => {
    // Overtaking needs the boat faster than the waves, which means a short
    // steep sea, not a long swell — a 14-second swell runs at over 40 knots
    // and nothing here catches it. A 5-second sea makes about 15.
    expect(encounterPeriodS(5, 180, 20)).toBeNull();
    // The long swell is not nonsense, just rare: it is reported, not refused.
    expect(encounterPeriodS(14, 180, 25)).toBeGreaterThan(14);
  });

  it('is symmetric about the wave axis', () => {
    expect(encounterPeriodS(8, 60, 6)).toBeCloseTo(encounterPeriodS(8, -60, 6)!, 10);
  });
});

describe('roll resonance', () => {
  const routeIn = (waves: WaveSampler) =>
    routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -66 },
      departure: T0,
      polar,
      wind: steadyWind(14, 0),
      waves
    });

  it('reports nothing without a measured roll period', () => {
    expect(summarisePassage(routeIn(steadySea(2, 90)))!.rollResonance).toBeNull();
    expect(summarisePassage(routeIn(steadySea(2, 90)), {})!.rollResonance).toBeNull();
    expect(summarisePassage(routeIn(steadySea(2, 90)), { rollPeriodS: 0 })!.rollResonance).toBeNull();
  });

  it('finds the passage rolling when the sea arrives in step with the boat', () => {
    // Beam sea: the encounter period is the wave period, so a boat whose roll
    // period matches it rolls for the whole passage.
    const inStep = summarisePassage(routeIn(steadySea(2, 0, 8)), { rollPeriodS: 8 })!;
    const outOfStep = summarisePassage(routeIn(steadySea(2, 0, 8)), { rollPeriodS: 3 })!;
    expect(inStep.rollResonance!.fraction).toBeGreaterThan(outOfStep.rollResonance!.fraction);
    expect(inStep.rollResonance!.rollPeriodS).toBe(8);
  });

  it('carries the hours that could not be judged rather than calling them calm', () => {
    const summary = summarisePassage(routeIn(steadySea(2, 90, 8)), { rollPeriodS: 8 })!;
    const r = summary.rollResonance!;
    expect(r.hours + r.unknownHours).toBeLessThanOrEqual(summary.hours + 0.001);
  });

  it('says nothing where the forecast carried no period', () => {
    const summary = summarisePassage(routeIn(steadySea(2, 90, null)), { rollPeriodS: 8 })!;
    expect(summary.rollResonance!.fraction).toBe(0);
    expect(summary.rollResonance!.hours).toBe(0);
  });
});
