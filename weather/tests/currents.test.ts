import { describe, it, expect, vi } from 'vitest';
import {
  fetchMarineField,
  createCurrentSampler,
  currentToComponents,
  currentFromComponents,
  speedToKnots
} from '../src/marineField.js';
import {
  routeIsochrone,
  distanceNm,
  type WindSampler,
  type WaveSampler,
  type CurrentSampler
} from '../src/routing.js';
import { summarisePassage } from '../src/passageSummary.js';
import { solarElevationDeg, isNightAt } from '../src/sun.js';
import { GENERIC_POLARS } from '../src/polars.js';

const T0 = Date.UTC(2026, 7, 22, 12, 0, 0);
const polar = GENERIC_POLARS.cruisingMonohull;

const steadyWind = (speedKts: number, directionDeg: number): WindSampler => () => ({
  speedKts,
  directionDeg
});
const steadyCurrent = (speedKts: number, setDeg: number): CurrentSampler => () => ({
  speedKts,
  setDeg
});

describe('current vectors', () => {
  it('sets the way it is going, not the way it came from', () => {
    // The convention trap. A current setting 090 flows EAST, so its eastward
    // component is positive — the opposite sign to a wind FROM 090.
    const east = currentToComponents(2, 90);
    expect(east.u).toBeCloseTo(2, 6);
    expect(east.v).toBeCloseTo(0, 6);

    const north = currentToComponents(2, 0);
    expect(north.u).toBeCloseTo(0, 6);
    expect(north.v).toBeCloseTo(2, 6);
  });

  it.each([0, 45, 90, 180, 270, 359])('round-trips a set of %s', (set) => {
    const { u, v } = currentToComponents(1.7, set);
    const back = currentFromComponents(u, v);
    expect(back.speedKts).toBeCloseTo(1.7, 6);
    expect(back.setDeg).toBeCloseTo(set, 6);
  });
});

describe('speedToKnots', () => {
  it('converts the unit the endpoint actually reports', () => {
    expect(speedToKnots(1.852, 'km/h')).toBeCloseTo(1, 6);
    expect(speedToKnots(1, 'kn')).toBe(1);
    expect(speedToKnots(1, 'm/s')).toBeCloseTo(1.9438, 3);
  });

  it('defaults to the documented unit but refuses one it does not know', () => {
    expect(speedToKnots(1.852, undefined)).toBeCloseTo(1, 6);
    expect(Number.isNaN(speedToKnots(5, 'furlongs/fortnight'))).toBe(true);
  });
});

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

function stubMarine(count: number, hours: number, velocity: unknown, direction: unknown, unit = 'km/h') {
  const time = Array.from({ length: hours }, (_, i) =>
    new Date(T0 + i * 3600_000).toISOString().slice(0, 16)
  );
  return Array.from({ length: count }, () => ({
    hourly_units: { ocean_current_velocity: unit },
    hourly: {
      time,
      wave_height: time.map(() => 1.2),
      wave_direction: time.map(() => 200),
      wave_period: time.map(() => 8),
      ocean_current_velocity: time.map(() => velocity),
      ocean_current_direction: time.map(() => direction)
    }
  }));
}

describe('fetchMarineField with currents', () => {
  it('asks for the current variables on the grid it was already paying for', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(stubMarine(1, 4, 3.704, 90))) as unknown as typeof fetch;
    const field = await fetchMarineField({ south: 40, north: 40, west: -70, east: -70 }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = (fetchImpl as any).mock.calls[0][0] as string;
    expect(url).toContain('ocean_current_velocity,ocean_current_direction');
    // 3.704 km/h is exactly 2 knots, setting east.
    expect(field.currentU[0][0][0]).toBeCloseTo(2, 3);
    expect(field.currentV[0][0][0]).toBeCloseTo(0, 3);
  });

  it('reads the speed unit off the response rather than assuming it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(stubMarine(1, 4, 2, 0, 'kn'))) as unknown as typeof fetch;
    const field = await fetchMarineField({ south: 40, north: 40, west: -70, east: -70 }, { fetchImpl });
    expect(field.currentV[0][0][0]).toBeCloseTo(2, 6);
  });

  it('treats a missing current as no current, not as a broken forecast', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(stubMarine(1, 4, null, null))) as unknown as typeof fetch;
    const field = await fetchMarineField({ south: 40, north: 40, west: -70, east: -70 }, { fetchImpl });
    expect(Number.isNaN(field.currentU[0][0][0])).toBe(true);
    // The sea state on the same point is untouched.
    expect(field.height[0][0][0]).toBe(1.2);
    expect(createCurrentSampler(field)(40, -70, T0)).toBeNull();
  });

  it('interpolates opposing currents as vectors, not as degrees', async () => {
    // Two cells setting in opposite directions average to slack water, not to
    // a confident stream at right angles to both.
    const fetchImpl = vi.fn(async () => {
      const points = [
        ...stubMarine(1, 4, 3.704, 0),
        ...stubMarine(1, 4, 3.704, 0),
        ...stubMarine(1, 4, 3.704, 180),
        ...stubMarine(1, 4, 3.704, 180)
      ];
      return jsonResponse(points);
    }) as unknown as typeof fetch;
    const field = await fetchMarineField(
      { south: 40, north: 42, west: -70, east: -68 },
      { resolutionDeg: 2, fetchImpl }
    );
    const sample = createCurrentSampler(field)(41, -69, T0)!;
    expect(sample.speedKts).toBeCloseTo(0, 6);
  });
});

describe('routing through a current', () => {
  const base = {
    start: { lat: 40, lon: -70 },
    destination: { lat: 40, lon: -66 },
    departure: T0,
    polar,
    wind: steadyWind(14, 0) // northerly; the passage east is a beam reach
  };

  it('is unchanged when no current is supplied', () => {
    const route = routeIsochrone(base);
    expect(route.maxCurrentKts).toBeNull();
    expect(route.legs.every((l) => l.currentKts === null)).toBe(true);
    expect(route.legs.every((l) => !l.windAgainstCurrent)).toBe(true);
  });

  it('arrives sooner with a fair current than a foul one', () => {
    const fair = routeIsochrone({ ...base, currents: steadyCurrent(2, 90) }); // setting east, with us
    const foul = routeIsochrone({ ...base, currents: steadyCurrent(2, 270) }); // setting west, against
    expect(fair.reachedDestination).toBe(true);
    expect(foul.reachedDestination).toBe(true);
    expect(fair.etaHours).toBeLessThan(foul.etaHours);
  });

  it('makes good over the ground more than the boat is doing through the water', () => {
    const route = routeIsochrone({ ...base, currents: steadyCurrent(2, 90) });
    const sailed = route.legs.filter((l) => l.groundSpeedKts > 0);
    expect(sailed.length).toBeGreaterThan(0);
    // Carried by two knots of fair stream, the ground track beats the log.
    const carried = sailed.filter((l) => l.groundSpeedKts > l.boatSpeedKts);
    expect(carried.length).toBeGreaterThan(sailed.length / 2);
    expect(route.maxCurrentKts).toBeCloseTo(2, 2);
    expect(route.legs.some((l) => l.currentSetDeg === 90)).toBe(true);
  });

  it('changes the wind the sails feel, not just the track', () => {
    // A current running with the wind reduces the breeze over the water.
    // Northerly wind blows south; a current setting south chases it.
    const still = routeIsochrone(base);
    const chasing = routeIsochrone({ ...base, currents: steadyCurrent(3, 180) });
    const windIn = (r: typeof still) => r.legs[1]?.twsKts ?? 0;
    expect(windIn(chasing)).toBeLessThan(windIn(still));
  });

  it('flags wind over tide, and only when both are real', () => {
    // Northerly 18 kt blows toward the south; a current setting north opposes it.
    const overTide = routeIsochrone({ ...base, wind: steadyWind(18, 0), currents: steadyCurrent(2, 0) });
    expect(overTide.legs.some((l) => l.windAgainstCurrent)).toBe(true);
    expect(overTide.warnings.some((w) => w.includes('wind blowing against the current'))).toBe(true);

    // Same opposition, but a current too weak to stand a sea up.
    const trickle = routeIsochrone({ ...base, wind: steadyWind(18, 0), currents: steadyCurrent(0.3, 0) });
    expect(trickle.legs.every((l) => !l.windAgainstCurrent)).toBe(true);

    // Same current, but no wind worth speaking of.
    const light = routeIsochrone({ ...base, wind: steadyWind(6, 0), currents: steadyCurrent(2, 0) });
    expect(light.legs.every((l) => !l.windAgainstCurrent)).toBe(true);

    // Real wind, real current, but crossing rather than opposing.
    const crossing = routeIsochrone({ ...base, wind: steadyWind(18, 0), currents: steadyCurrent(2, 90) });
    expect(crossing.legs.every((l) => !l.windAgainstCurrent)).toBe(true);
  });

  it('says the ocean model knows nothing about tidal gates', () => {
    const route = routeIsochrone({ ...base, currents: steadyCurrent(1.5, 90) });
    expect(route.warnings.some((w) => w.includes('tidal gates'))).toBe(true);
  });

  it('says so when the current model did not reach the passage', () => {
    const route = routeIsochrone({ ...base, currents: () => null });
    expect(route.maxCurrentKts).toBeNull();
    expect(route.warnings.some((w) => w.includes('No current data covered'))).toBe(true);
  });

  it('reports wind against current as a share of the passage', () => {
    const route = routeIsochrone({ ...base, wind: steadyWind(18, 0), currents: steadyCurrent(2, 0) });
    const summary = summarisePassage(route)!;
    expect(summary.windAgainstCurrent).not.toBeNull();
    expect(summary.windAgainstCurrent!.fraction).toBeGreaterThan(0.5);

    const none = summarisePassage(routeIsochrone(base))!;
    expect(none.windAgainstCurrent).toBeNull();
  });
});

describe('solar elevation', () => {
  it('puts the sun up at midday and down at midnight', () => {
    // Greenwich, midsummer.
    const noon = Date.UTC(2026, 5, 21, 12, 0, 0);
    const midnight = Date.UTC(2026, 5, 21, 0, 0, 0);
    expect(solarElevationDeg(51.48, 0, noon)).toBeGreaterThan(55);
    expect(solarElevationDeg(51.48, 0, midnight)).toBeLessThan(-10);
  });

  it('knows midday in Greenwich is the middle of the night in the Pacific', () => {
    const t = Date.UTC(2026, 5, 21, 12, 0, 0);
    expect(isNightAt(51.48, 0, t)).toBe(false);
    expect(isNightAt(21.3, -157.8, t)).toBe(true); // Honolulu, 2am local
  });

  it('keeps the sun up all night inside the Arctic summer', () => {
    const t = Date.UTC(2026, 5, 21, 0, 0, 0);
    expect(isNightAt(78.9, 11.9, t)).toBe(false); // Svalbard, midnight sun
  });

  it('agrees with a known sunset to within a few minutes', () => {
    // Greenwich sunset on the equinox is about 17:47 UTC.
    expect(isNightAt(51.48, 0, Date.UTC(2026, 8, 22, 17, 30, 0))).toBe(false);
    expect(isNightAt(51.48, 0, Date.UTC(2026, 8, 22, 18, 5, 0))).toBe(true);
  });
});

describe('night and landfall', () => {
  const waves: WaveSampler = () => ({ heightM: 1.4, directionDeg: 180, periodS: 8 });

  it('counts the dark hours and the work done in them', () => {
    const route = routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 36, lon: -62 },
      departure: T0,
      polar,
      wind: steadyWind(15, 20),
      waves
    });
    const summary = summarisePassage(route)!;
    // A passage of several days is roughly half darkness.
    expect(summary.night.fraction).toBeGreaterThan(0.3);
    expect(summary.night.fraction).toBeLessThan(0.7);
    expect(summary.night.hours).toBeGreaterThan(0);
    expect(summary.night.manoeuvres).toBeLessThanOrEqual(
      route.legs.filter((l) => l.manoeuvre).length
    );
  });

  it('describes the landfall, which every average hides', () => {
    const route = routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -66 },
      departure: T0,
      polar,
      wind: steadyWind(15, 0),
      waves
    });
    const summary = summarisePassage(route)!;
    expect(summary.landfall).not.toBeNull();
    expect(summary.landfall!.twsKts).toBeGreaterThan(0);
    expect(summary.landfall!.waveHeightM).toBeCloseTo(1.4, 1);
    expect(typeof summary.landfall!.atNight).toBe('boolean');
    // It is the arrival, not the departure.
    expect(Date.parse(summary.landfall!.time)).toBeGreaterThan(T0);
  });

  it('has no landfall to describe when the passage never arrived', () => {
    const route = routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -20 },
      departure: T0,
      polar,
      wind: steadyWind(12, 90),
      maxHours: 6
    });
    expect(route.reachedDestination).toBe(false);
    expect(summarisePassage(route)?.landfall ?? null).toBeNull();
  });
});
