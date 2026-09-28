import { describe, it, expect } from 'vitest';
import { routeIsochrone, type WindSampler, type WaveSampler } from '../src/routing.js';
import { boatSpeed, GENERIC_POLARS } from '../src/polars.js';
import { summarisePassage } from '../src/passageSummary.js';
import {
  powerPolar,
  powerSeaState,
  powerRangeFrom,
  isUsablePowerProfile,
  type PowerProfile
} from '../src/powerPerformance.js';

const T0 = Date.UTC(2026, 7, 22, 0, 0, 0);

/** The trawler off the PredictWind screenshot, in the units this package uses. */
const TRAWLER: PowerProfile = {
  economicSpeedKts: 8,
  economicRpm: 2000,
  fuelLitresPerHour: 11,
  tankLitres: 1200,
  reservePercent: 20,
  lwlM: 11.8,
  draughtM: 1.0
};

const steadyWind = (speedKts: number, directionDeg: number): WindSampler => () => ({
  speedKts,
  directionDeg
});
const steadySea = (heightM: number, directionDeg: number, periodS: number | null = 8): WaveSampler =>
  () => ({ heightM, directionDeg, periodS });

describe('the power performance model', () => {
  it('needs a speed, a burn and a tank before it will model anything', () => {
    expect(isUsablePowerProfile(TRAWLER)).toBe(true);
    expect(isUsablePowerProfile({ ...TRAWLER, tankLitres: 0 })).toBe(false);
    expect(isUsablePowerProfile({ ...TRAWLER, fuelLitresPerHour: 0 })).toBe(false);
    expect(isUsablePowerProfile(null)).toBe(false);
  });

  it('does its stated speed in a flat calm', () => {
    // The whole reason the table carries a zero-knot column. A polar built
    // without one is ramped linearly to zero below its lightest wind, which
    // would leave a motorboat becalmed with its engine running.
    const polar = powerPolar(TRAWLER);
    expect(boatSpeed(polar, 0, 0)).toBeCloseTo(8, 6);
    expect(boatSpeed(polar, 90, 0.2)).toBeCloseTo(8, 1);
  });

  it('has no no-go zone: it makes way straight into the wind', () => {
    const polar = powerPolar(TRAWLER);
    expect(boatSpeed(polar, 0, 20)).toBeCloseTo(8, 6);
    // Where a sailing boat is stopped dead.
    expect(boatSpeed(GENERIC_POLARS.cruisingMonohull, 0, 20)).toBe(0);
  });

  it('is flat: the wind is not charged against a motorboat', () => {
    // Windage was removed on purpose (2026-09-28). Every cell is the economic
    // speed, from a flat calm to 50 knots, dead ahead or dead astern.
    const polar = powerPolar(TRAWLER);
    for (const row of polar.speeds) for (const cell of row) expect(cell).toBe(8);
    for (const twa of [0, 180]) {
      for (const tws of [0, 50]) expect(boatSpeed(polar, twa, tws)).toBe(8);
    }
    expect(polar.twsValues[0]).toBe(0);
    expect(polar.note).toBe(
      'Timings hold 8 knots at the economic throttle setting in any wind; the sea is charged ' +
        'along the route, the wind is not. The setting is the only one modelled, so a plan that ' +
        'would have you throttle up to clear a front is a plan this cannot make.'
    );
    expect(polar.note).toMatch(/the wind is not/);
  });

  it('names the throttle setting it was built from', () => {
    expect(powerPolar(TRAWLER).name).toBe('Under power at 8 kt (2000 rpm)');
    expect(powerPolar({ ...TRAWLER, economicRpm: null }).name).toBe('Under power at 8 kt');
  });

  it('scales the sea penalty against the waterline length it was given', () => {
    expect(powerSeaState(TRAWLER).referenceLengthM).toBe(11.8);
    expect(powerSeaState({ ...TRAWLER, lwlM: null }).referenceLengthM).toBe(12);
    // Heavier than the sailing default of 0.3: a motorboat in a head sea comes
    // off its cruising revs, and that is a bigger effect than added resistance.
    expect(powerSeaState(TRAWLER).coefficient).toBeGreaterThan(0.3);
  });

  it('works the tank out as hours, and keeps the reserve out of them', () => {
    const range = powerRangeFrom(TRAWLER)!;
    expect(range.usableLitres).toBeCloseTo(960, 6); // 1200 less 20%
    expect(range.enduranceHours).toBeCloseTo(960 / 11, 1);
    expect(range.rangeNm).toBe(Math.round((960 / 11) * 8));
    expect(powerRangeFrom({ ...TRAWLER, tankLitres: 0 })).toBeNull();
  });
});

describe('routing under power', () => {
  const base = {
    start: { lat: 40, lon: -70 },
    destination: { lat: 40, lon: -68 },
    departure: T0,
    polar: powerPolar(TRAWLER),
    propulsion: 'power' as const,
    seaState: powerSeaState(TRAWLER),
    fuel: { litresPerHour: 11, usableLitres: 960 }
  };

  it('crosses a flat calm that would strand a sailing boat', () => {
    const calm = steadyWind(0, 0);
    const powered = routeIsochrone({ ...base, wind: calm });
    expect(powered.reachedDestination).toBe(true);
    expect(powered.propulsion).toBe('power');

    const sailed = routeIsochrone({
      start: base.start,
      destination: base.destination,
      departure: T0,
      polar: GENERIC_POLARS.cruisingMonohull,
      wind: calm
    });
    expect(sailed.reachedDestination).toBe(false);
  });

  it('reports every hour as engine time, and the fuel that cost', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(10, 90) });
    expect(route.reachedDestination).toBe(true);
    // Leg 0 is the departure point itself, which is not a leg anyone runs.
    expect(route.legs.slice(1).every((l) => l.motoring)).toBe(true);
    expect(route.motoringHours).toBeCloseTo(route.etaHours, 1);
    expect(route.fuelLitres).toBeCloseTo(route.etaHours * 11, 0);
    expect(route.usableFuelLitres).toBe(960);
  });

  it('never reports a tack or a gybe, whatever the wind does', () => {
    // A wind that swings right across the vessel mid-passage: under sail this
    // is exactly the shape that produces manoeuvres.
    const swinging: WindSampler = (_lat, lon) => ({
      speedKts: 18,
      directionDeg: lon > -69 ? 330 : 30
    });
    const powered = routeIsochrone({ ...base, wind: swinging });
    expect(powered.legs.some((l) => l.manoeuvre !== null)).toBe(false);
  });

  it('ignores a watch policy that would forbid sail changes it never makes', () => {
    const swinging: WindSampler = (_lat, lon) => ({
      speedKts: 18,
      directionDeg: lon > -69 ? 330 : 30
    });
    const free = routeIsochrone({ ...base, wind: swinging });
    const strict = routeIsochrone({
      ...base,
      wind: swinging,
      nightManoeuvre: { tackPenaltyMinutes: Infinity, gybePenaltyMinutes: Infinity }
    });
    expect(strict.etaHours).toBeCloseTo(free.etaHours, 6);
    expect(strict.warnings.some((w) => w.includes('sail change'))).toBe(false);
  });

  it('is slowed by a head sea, and burns the same litres an hour doing it', () => {
    const flat = routeIsochrone({ ...base, wind: steadyWind(12, 90) });
    const rough = routeIsochrone({
      ...base,
      wind: steadyWind(12, 90),
      waves: steadySea(2.5, 270) // on the bow for an easterly passage
    });
    expect(rough.reachedDestination).toBe(true);
    expect(rough.etaHours).toBeGreaterThan(flat.etaHours);
    // The point of the whole model: weather costs a motorboat fuel, because
    // the burn does not fall with the speed.
    expect(rough.fuelLitres!).toBeGreaterThan(flat.fuelLitres!);
    expect(rough.fuelLitres!).toBeCloseTo(rough.etaHours * 11, 0);
  });

  it('stops where the fuel does, and says so in its own terms', () => {
    const short = routeIsochrone({
      ...base,
      destination: { lat: 40, lon: -55 }, // far beyond the tank
      wind: steadyWind(8, 90),
      fuel: { litresPerHour: 11, usableLitres: 110 } // ten hours
    });
    expect(short.reachedDestination).toBe(false);
    expect(short.ranOutOfFuel).toBe(true);
    expect(short.etaHours).toBeLessThanOrEqual(11);
    expect(short.warnings.some((w) => w.includes('usable fuel aboard runs out'))).toBe(true);
    // And not blamed on the weather, which was fine.
    expect(short.warnings.some((w) => w.includes('not reached within'))).toBe(false);
  });

  it('lets a passage finish on the last part-hour in the tank', () => {
    const generous = routeIsochrone({ ...base, wind: steadyWind(6, 90) });
    expect(generous.reachedDestination).toBe(true);
    const exact = routeIsochrone({
      ...base,
      wind: steadyWind(6, 90),
      fuel: { litresPerHour: 11, usableLitres: generous.etaHours * 11 * 1.001 }
    });
    expect(exact.reachedDestination).toBe(true);
    expect(exact.ranOutOfFuel).toBe(false);
  });

  it('warns when the passage arrives on the reserve and nothing else', () => {
    const tight = routeIsochrone({ ...base, wind: steadyWind(6, 90) });
    const onFumes = routeIsochrone({
      ...base,
      wind: steadyWind(6, 90),
      fuel: { litresPerHour: 11, usableLitres: tight.etaHours * 11 * 1.05 }
    });
    expect(onFumes.reachedDestination).toBe(true);
    expect(onFumes.warnings.some((w) => w.includes('usable litres'))).toBe(true);
  });

  it('talks to a motorboat owner about running the route, not sailing it', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(10, 90) });
    expect(route.warnings[0]).toContain('before running it');
    expect(route.warnings.join(' ')).not.toContain('before sailing it');
  });

  it('leaves a sailing route byte-for-byte as it was', () => {
    const sail = {
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -68 },
      departure: T0,
      polar: GENERIC_POLARS.cruisingMonohull,
      wind: steadyWind(14, 200)
    };
    const before = routeIsochrone(sail);
    const after = routeIsochrone({ ...sail, propulsion: 'sail' as const });
    expect(after.etaHours).toBe(before.etaHours);
    expect(before.propulsion).toBe('sail');
    expect(before.usableFuelLitres).toBeNull();
    expect(before.ranOutOfFuel).toBe(false);
    expect(before.warnings[0]).toContain('before sailing it');
  });
});

describe('summarising a passage under power', () => {
  const base = {
    start: { lat: 40, lon: -70 },
    destination: { lat: 40, lon: -68 },
    departure: T0,
    polar: powerPolar(TRAWLER),
    propulsion: 'power' as const,
    seaState: powerSeaState(TRAWLER),
    fuel: { litresPerHour: 11, usableLitres: 960 }
  };

  it('reports no points of sail, because a motorboat has none', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(14, 200) });
    const summary = summarisePassage(route, { fuel: base.fuel })!;
    expect(summary.pointOfSail).toBeNull();
    expect(summary.night.manoeuvres).toBe(0);
  });

  it('still reports points of sail for a sailing boat', () => {
    const route = routeIsochrone({
      start: base.start,
      destination: base.destination,
      departure: T0,
      polar: GENERIC_POLARS.cruisingMonohull,
      wind: steadyWind(14, 200)
    });
    const summary = summarisePassage(route)!;
    expect(summary.pointOfSail).not.toBeNull();
    expect(
      summary.pointOfSail!.upwind + summary.pointOfSail!.reaching + summary.pointOfSail!.downwind
    ).toBeCloseTo(1, 2);
  });

  it('says which way the sea is meeting the vessel', () => {
    // The passage runs east, so a sea running FROM 270 is astern of it and a
    // sea running FROM 090 is on the bow. Same water, opposite days.
    const astern = summarisePassage(
      routeIsochrone({ ...base, wind: steadyWind(12, 90), waves: steadySea(2, 270) }),
      { fuel: base.fuel }
    )!;
    expect(astern.seaAngle).not.toBeNull();
    const { head, beam, following } = astern.seaAngle!;
    expect(head + beam + following).toBeCloseTo(1, 2);
    expect(following).toBeGreaterThan(0.9);

    const onTheBow = summarisePassage(
      routeIsochrone({ ...base, wind: steadyWind(12, 90), waves: steadySea(2, 90) }),
      { fuel: base.fuel }
    )!;
    expect(onTheBow.seaAngle!.head).toBeGreaterThan(0.9);
  });

  it('has no sea angle to report when the marine forecast reached none of it', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(12, 90) });
    expect(summarisePassage(route, { fuel: base.fuel })!.seaAngle).toBeNull();
  });

  it('counts the whole passage as engine time and states the tank in litres', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(10, 90) });
    const summary = summarisePassage(route, { fuel: base.fuel })!;
    expect(summary.motoring).not.toBeNull();
    expect(summary.motoring!.fraction).toBeCloseTo(1, 2);
    expect(summary.motoring!.usableLitres).toBe(960);
    expect(summary.motoring!.enduranceHours).toBeCloseTo(960 / 11, 1);
    // Arriving under power is not news for a vessel that has no other way of
    // arriving, so the flag a sailing boat uses stays down.
    expect(summary.motoring!.intoLandfall).toBe(false);
  });
});
