import { describe, it, expect, vi } from 'vitest';
import {
  fetchWindField,
  createWindSampler,
  boundsForPassage,
  toComponents,
  fromComponents,
  type WindField
} from '../src/windField.js';
import { routeIsochrone } from '../src/routing.js';
import { GENERIC_POLARS } from '../src/polars.js';

const T0 = Date.UTC(2026, 7, 22, 0, 0, 0);

describe('wind vector conversion', () => {
  it.each([
    ['northerly', 10, 0],
    ['easterly', 10, 90],
    ['southerly', 10, 180],
    ['westerly', 10, 270],
    ['south-westerly', 17.5, 225]
  ])('round-trips a %s', (_label, speed, direction) => {
    const { u, v } = toComponents(speed, direction);
    const back = fromComponents(u, v);
    expect(back.speedKts).toBeCloseTo(speed, 6);
    expect(back.directionDeg).toBeCloseTo(direction, 6);
  });

  it('puts a northerly wind vector southward', () => {
    // Wind FROM the north blows toward the south: v is negative.
    const { u, v } = toComponents(10, 0);
    expect(u).toBeCloseTo(0, 6);
    expect(v).toBeCloseTo(-10, 6);
  });
});

describe('boundsForPassage', () => {
  it('covers both ends with room to detour', () => {
    const b = boundsForPassage({ lat: 41.5, lon: -71.3 }, { lat: 32.3, lon: -64.8 }, 2);
    expect(b.north).toBeCloseTo(43.5);
    expect(b.south).toBeCloseTo(30.3);
    expect(b.east).toBeCloseTo(-62.8);
    expect(b.west).toBeCloseTo(-73.3);
  });

  it('does not run off the ends of the earth', () => {
    const b = boundsForPassage({ lat: 89, lon: 179 }, { lat: 89.5, lon: 179.5 }, 5);
    expect(b.north).toBe(90);
    expect(b.east).toBe(180);
  });
});

/** Grid where every point reports the same wind, so interpolation is checkable. */
function stubGrid(lats: number[], lons: number[], hours: number, speed: number, direction: number) {
  const time = Array.from({ length: hours }, (_, i) =>
    new Date(T0 + i * 3600_000).toISOString().slice(0, 16)
  );
  return lats.flatMap(() =>
    lons.map(() => ({
      hourly: {
        time,
        wind_speed_10m: Array(hours).fill(speed),
        wind_direction_10m: Array(hours).fill(direction)
      }
    }))
  );
}

const bounds = { south: 40, north: 42, west: -71, east: -69 };

function stubFetch(payload: any, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => payload })) as any;
}

describe('fetchWindField', () => {
  it('requests one call for the whole grid and indexes it by lat/lon/time', async () => {
    const lats = [40, 41, 42];
    const lons = [-71, -70, -69];
    const fetchImpl = stubFetch(stubGrid(lats, lons, 6, 12, 225));
    const field = await fetchWindField(bounds, { resolutionDeg: 1, days: 1, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(field.lats).toEqual(lats);
    expect(field.lons).toEqual(lons);
    expect(field.times).toHaveLength(6);
    expect(field.times[0]).toBe(T0);
    expect(field.u).toHaveLength(6);
    expect(field.u[0]).toHaveLength(3);
    expect(field.u[0][0]).toHaveLength(3);
  });

  it('parses upstream times as UTC', async () => {
    const fetchImpl = stubFetch(stubGrid([40, 41, 42], [-71, -70, -69], 3, 10, 0));
    const field = await fetchWindField(bounds, { resolutionDeg: 1, days: 1, fetchImpl });
    expect(new Date(field.times[1]).toISOString()).toBe('2026-08-22T01:00:00.000Z');
  });

  it('rejects a grid that does not match the coordinates asked for', async () => {
    const fetchImpl = stubFetch([{ hourly: { time: ['2026-08-22T00:00'], wind_speed_10m: [10], wind_direction_10m: [0] } }]);
    await expect(fetchWindField(bounds, { resolutionDeg: 1, days: 1, fetchImpl }))
      .rejects.toThrow(/forecast points for a/);
  });

  it('surfaces an upstream failure', async () => {
    const fetchImpl = stubFetch(null, false, 503);
    await expect(fetchWindField(bounds, { resolutionDeg: 1, days: 1, fetchImpl }))
      .rejects.toThrow(/HTTP 503/);
  });
});

describe('createWindSampler', () => {
  async function field(speed = 12, direction = 225): Promise<WindField> {
    const fetchImpl = stubFetch(stubGrid([40, 41, 42], [-71, -70, -69], 12, speed, direction));
    return fetchWindField(bounds, { resolutionDeg: 1, days: 1, fetchImpl });
  }

  it('returns the wind at a grid point', async () => {
    const sample = createWindSampler(await field())(41, -70, T0);
    expect(sample!.speedKts).toBeCloseTo(12, 6);
    expect(sample!.directionDeg).toBeCloseTo(225, 6);
  });

  it('interpolates between grid points and hours', async () => {
    const sample = createWindSampler(await field())(40.5, -70.5, T0 + 1800_000);
    expect(sample!.speedKts).toBeCloseTo(12, 6);
    expect(sample!.directionDeg).toBeCloseTo(225, 6);
  });

  it('interpolates direction as a vector, so it never averages across north backwards', async () => {
    // Two hours: wind backing from 350° to 010°. The honest midpoint is due north.
    const time = [T0, T0 + 3600_000].map((t) => new Date(t).toISOString().slice(0, 16));
    const grid = [40, 41].flatMap(() =>
      [-71, -70].map(() => ({
        hourly: { time, wind_speed_10m: [10, 10], wind_direction_10m: [350, 10] }
      }))
    );
    const f = await fetchWindField({ south: 40, north: 41, west: -71, east: -70 }, {
      resolutionDeg: 1, days: 1, fetchImpl: stubFetch(grid)
    });
    const mid = createWindSampler(f)(40.5, -70.5, T0 + 1800_000)!;
    // Arithmetic averaging would say 180° — a southerly in a northerly breeze.
    expect(Math.min(mid.directionDeg, 360 - mid.directionDeg)).toBeLessThan(1);
    expect(mid.speedKts).toBeGreaterThan(9.8);
  });

  it('returns null outside the grid rather than pretending the edge continues', async () => {
    const sampler = createWindSampler(await field());
    expect(sampler(50, -70, T0)).toBeNull(); // north of the grid
    expect(sampler(41, -50, T0)).toBeNull(); // east of the grid
    expect(sampler(41, -70, T0 - 3600_000)).toBeNull(); // before the forecast
    expect(sampler(41, -70, T0 + 100 * 3600_000)).toBeNull(); // past the forecast
  });

  it('returns null where the model has a hole', async () => {
    const time = [T0, T0 + 3600_000].map((t) => new Date(t).toISOString().slice(0, 16));
    const grid = [40, 41].flatMap((la) =>
      [-71, -70].map((lo) => ({
        hourly: {
          time,
          // One corner of the grid has no data.
          wind_speed_10m: la === 41 && lo === -70 ? [null, null] : [10, 10],
          wind_direction_10m: la === 41 && lo === -70 ? [null, null] : [270, 270]
        }
      }))
    );
    const f = await fetchWindField({ south: 40, north: 41, west: -71, east: -70 }, {
      resolutionDeg: 1, days: 1, fetchImpl: stubFetch(grid)
    });
    expect(createWindSampler(f)(40.5, -70.5, T0)).toBeNull();
  });
});

describe('field feeding the router', () => {
  it('routes a passage end to end on fetched wind', async () => {
    const lats = [39, 40, 41];
    const lons = [-71, -70, -69, -68, -67];
    const time = Array.from({ length: 48 }, (_, i) =>
      new Date(T0 + i * 3600_000).toISOString().slice(0, 16)
    );
    const grid = lats.flatMap(() =>
      lons.map(() => ({
        hourly: {
          time,
          wind_speed_10m: Array(48).fill(14),
          wind_direction_10m: Array(48).fill(0) // northerly: due east is a beam reach
        }
      }))
    );
    const f = await fetchWindField({ south: 39, north: 41, west: -71, east: -67 }, {
      resolutionDeg: 1, days: 2, fetchImpl: stubFetch(grid)
    });

    const result = routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -67.4 },
      departure: T0,
      polar: GENERIC_POLARS.cruisingMonohull,
      wind: createWindSampler(f),
      stepMinutes: 30
    });

    expect(result.reachedDestination).toBe(true);
    expect(result.etaHours).toBeGreaterThan(13);
    expect(result.etaHours).toBeLessThan(20);
  });

  it('stalls honestly when the passage sails off the edge of the forecast', async () => {
    const f = await fetchWindField({ south: 40, north: 41, west: -71, east: -70 }, {
      resolutionDeg: 1, days: 1,
      fetchImpl: stubFetch(stubGrid([40, 41], [-71, -70], 12, 14, 0))
    });
    const result = routeIsochrone({
      start: { lat: 40.5, lon: -70.5 },
      destination: { lat: 40.5, lon: -60 }, // far outside the grid
      departure: T0,
      polar: GENERIC_POLARS.cruisingMonohull,
      wind: createWindSampler(f)
    });
    expect(result.reachedDestination).toBe(false);
    expect(result.warnings.some((w) => /stalled|no usable wind/i.test(w))).toBe(true);
  });
});
