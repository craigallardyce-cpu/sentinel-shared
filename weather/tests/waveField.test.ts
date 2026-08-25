import { describe, it, expect, vi } from 'vitest';
import {
  fetchWaveField,
  createWaveSampler,
  waveToComponents,
  waveFromComponents,
  type WaveField
} from '../src/waveField.js';
import { routeIsochrone, seaStateFactor, type WindSampler, type WaveSampler } from '../src/routing.js';
import { GENERIC_POLARS } from '../src/polars.js';

const T0 = Date.UTC(2026, 7, 22, 0, 0, 0);
const polar = GENERIC_POLARS.cruisingMonohull;

describe('wave direction vectors', () => {
  it.each([
    ['northerly', 0],
    ['easterly', 90],
    ['southerly', 180],
    ['westerly', 270],
    ['south-westerly', 225]
  ])('round-trips a %s sea', (_label, direction) => {
    const { u, v } = waveToComponents(direction);
    expect(waveFromComponents(u, v)).toBeCloseTo(direction, 6);
  });

  it('averages either side of north without swinging through south', () => {
    // The whole reason direction is carried as a vector: 350 and 10 average to
    // 0, not to 180.
    const a = waveToComponents(350);
    const b = waveToComponents(10);
    const mean = waveFromComponents((a.u + b.u) / 2, (a.v + b.v) / 2);
    expect(mean).toBeCloseTo(0, 6);
  });
});

/** A marine response for a grid, with `nulls` positions reported as land. */
function stubMarine(
  lats: number[],
  lons: number[],
  hours: number,
  height: number,
  direction: number,
  period: number,
  isLand: (lat: number, lon: number) => boolean = () => false
) {
  const time = Array.from({ length: hours }, (_, i) =>
    new Date(T0 + i * 3600_000).toISOString().slice(0, 16)
  );
  return lats.flatMap((lat) =>
    lons.map((lon) => ({
      hourly: {
        time,
        wave_height: time.map(() => (isLand(lat, lon) ? null : height)),
        wave_direction: time.map(() => (isLand(lat, lon) ? null : direction)),
        wave_period: time.map(() => (isLand(lat, lon) ? null : period))
      }
    }))
  );
}

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe('fetchWaveField', () => {
  it('asks the marine endpoint for the whole grid in one call', async () => {
    const lats = [30, 32, 34];
    const lons = [-66, -64];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(stubMarine(lats, lons, 6, 2.5, 180, 8))
    ) as unknown as typeof fetch;

    const field = await fetchWaveField(
      { south: 30, north: 34, west: -66, east: -64 },
      { resolutionDeg: 2, fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = (fetchImpl as any).mock.calls[0][0] as string;
    expect(url).toContain('marine-api.open-meteo.com');
    expect(url).toContain('wave_height,wave_direction,wave_period');
    expect(field.lats).toEqual(lats);
    expect(field.lons).toEqual(lons);
    expect(field.times[0]).toBe(T0);
    expect(field.height[0][0][0]).toBe(2.5);
  });

  it('caps the horizon at what the marine models publish', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(stubMarine([40], [-70], 3, 1, 270, 6))
    ) as unknown as typeof fetch;
    await fetchWaveField({ south: 40, north: 40, west: -70, east: -70 }, { days: 16, fetchImpl });
    expect((fetchImpl as any).mock.calls[0][0]).toContain('forecast_days=8');
  });

  it('accepts the bare object a single coordinate comes back as', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(stubMarine([40], [-70], 3, 1.2, 90, 5)[0])
    ) as unknown as typeof fetch;
    const field = await fetchWaveField(
      { south: 40, north: 40, west: -70, east: -70 },
      { fetchImpl }
    );
    expect(field.height[0][0][0]).toBe(1.2);
  });

  it('refuses a response with the wrong number of points', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(stubMarine([30], [-66], 3, 1, 0, 5))
    ) as unknown as typeof fetch;
    await expect(
      fetchWaveField({ south: 30, north: 34, west: -66, east: -64 }, { resolutionDeg: 2, fetchImpl })
    ).rejects.toThrow(/wave points/);
  });

  it('carries a land point through as no sea rather than as a failure', async () => {
    const lats = [40, 42];
    const lons = [-70, -68];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(stubMarine(lats, lons, 4, 3, 180, 9, (lat, lon) => lat === 40 && lon === -70))
    ) as unknown as typeof fetch;
    const field = await fetchWaveField(
      { south: 40, north: 42, west: -70, east: -68 },
      { resolutionDeg: 2, fetchImpl }
    );
    expect(Number.isNaN(field.height[0][0][0])).toBe(true);
    expect(field.height[0][1][1]).toBe(3);
  });
});

/** A field built directly, so the sampler can be checked without a fetch. */
function field(
  lats: number[],
  lons: number[],
  hours: number,
  at: (lat: number, lon: number, t: number) => { h: number; dir: number; period: number } | null
): WaveField {
  const times = Array.from({ length: hours }, (_, i) => T0 + i * 3600_000);
  const plane = (pick: (v: { h: number; dir: number; period: number }) => number) =>
    times.map((_, t) =>
      lats.map((lat) =>
        lons.map((lon) => {
          const v = at(lat, lon, t);
          return v ? pick(v) : NaN;
        })
      )
    );
  return {
    lats,
    lons,
    times,
    height: plane((v) => v.h),
    u: plane((v) => waveToComponents(v.dir).u),
    v: plane((v) => waveToComponents(v.dir).v),
    period: plane((v) => v.period)
  };
}

describe('createWaveSampler', () => {
  const steady = field([40, 42], [-70, -68], 4, () => ({ h: 2, dir: 225, period: 8 }));

  it('reads a steady sea anywhere inside the grid', () => {
    const sample = createWaveSampler(steady)(41, -69, T0 + 90 * 60_000);
    expect(sample?.heightM).toBeCloseTo(2, 6);
    expect(sample?.directionDeg).toBeCloseTo(225, 6);
    expect(sample?.periodS).toBeCloseTo(8, 6);
  });

  it('interpolates height between two corners', () => {
    const ramp = field([40, 42], [-70, -68], 2, (lat) => ({
      h: lat === 40 ? 1 : 3,
      dir: 180,
      period: 7
    }));
    expect(createWaveSampler(ramp)(41, -69, T0)?.heightM).toBeCloseTo(2, 6);
  });

  it('returns null outside the grid in space and in time', () => {
    const sampler = createWaveSampler(steady);
    expect(sampler(50, -69, T0)).toBeNull();
    expect(sampler(41, -50, T0)).toBeNull();
    expect(sampler(41, -69, T0 + 100 * 3600_000)).toBeNull();
  });

  it('still gives a sea state in a cell with a land corner', () => {
    // The coastal case, and the reason the sampler drops dead corners instead
    // of refusing the cell: most passages start in one of these.
    const coastal = field([40, 42], [-70, -68], 2, (lat, lon) =>
      lat === 40 && lon === -70 ? null : { h: 2.4, dir: 200, period: 9 }
    );
    const sample = createWaveSampler(coastal)(41, -69, T0);
    expect(sample?.heightM).toBeCloseTo(2.4, 6);
    expect(sample?.directionDeg).toBeCloseTo(200, 6);
  });

  it('returns null where no corner of the cell is sea', () => {
    const inland = field([40, 42], [-70, -68], 2, () => null);
    expect(createWaveSampler(inland)(41, -69, T0)).toBeNull();
  });

  it('reports a height even where the model gave no period', () => {
    const noPeriod = field([40, 42], [-70, -68], 2, () => ({ h: 1.5, dir: 90, period: NaN }));
    const sample = createWaveSampler(noPeriod)(41, -69, T0);
    expect(sample?.heightM).toBeCloseTo(1.5, 6);
    expect(sample?.periodS).toBeNull();
  });

  it('says nothing rather than invent a direction from two opposing seas', () => {
    const opposed = field([40, 42], [-70, -68], 2, (lat) => ({
      h: 2,
      dir: lat === 40 ? 0 : 180,
      period: 8
    }));
    expect(createWaveSampler(opposed)(41, -69, T0)).toBeNull();
  });
});

describe('seaStateFactor', () => {
  it('costs nothing in a flat calm', () => {
    expect(seaStateFactor(0, 0)).toBe(1);
  });

  it('costs more in a bigger sea, and much more', () => {
    // Squared in height: doubling the sea more than doubles the loss.
    const loss = (h: number) => 1 - seaStateFactor(h, 0);
    expect(loss(2)).toBeGreaterThan(loss(1) * 3);
    expect(loss(1)).toBeCloseTo(0.025, 3);
    expect(loss(2)).toBeCloseTo(0.1, 3);
    expect(loss(3)).toBeCloseTo(0.225, 3);
  });

  it('costs most on the bow and least astern', () => {
    const head = seaStateFactor(3, 0);
    const beam = seaStateFactor(3, 90);
    const following = seaStateFactor(3, 180);
    expect(head).toBeLessThan(beam);
    expect(beam).toBeLessThan(following);
    expect(following).toBeLessThan(1); // a following sea is never free speed
  });

  it('is symmetric about the wave axis', () => {
    expect(seaStateFactor(2.5, 60)).toBeCloseTo(seaStateFactor(2.5, -60), 12);
    expect(seaStateFactor(2.5, 60)).toBeCloseTo(seaStateFactor(2.5, 300), 12);
  });

  it('never takes more than the cap, however bad the forecast', () => {
    expect(seaStateFactor(15, 0)).toBeCloseTo(0.4, 6);
    expect(seaStateFactor(15, 0, null, { maxLossFraction: 0.5 })).toBeCloseTo(0.5, 6);
  });

  it('costs a longer boat less than a short one', () => {
    expect(seaStateFactor(3, 0, null, { referenceLengthM: 24 })).toBeGreaterThan(
      seaStateFactor(3, 0, null, { referenceLengthM: 12 })
    );
  });
});

const steadyWind = (speedKts: number, directionDeg: number): WindSampler => () => ({
  speedKts,
  directionDeg
});

const steadySea = (heightM: number, directionDeg: number): WaveSampler => () => ({
  heightM,
  directionDeg,
  periodS: 8
});

describe('routing through a sea', () => {
  const start = { lat: 40, lon: -70 };
  const destination = { lat: 40, lon: -66 };
  const base = {
    start,
    destination,
    departure: T0,
    polar,
    wind: steadyWind(16, 0) // northerly, so the passage east is a beam reach
  };

  it('is unchanged when no sea state is supplied', () => {
    const route = routeIsochrone(base);
    expect(route.reachedDestination).toBe(true);
    expect(route.maxWaveHeightM).toBeNull();
    expect(route.legs.every((l) => l.waveHeightM === null)).toBe(true);
    expect(route.warnings.some((w) => w.includes('Sea state is charged'))).toBe(false);
  });

  it('takes longer through a big head sea than a flat one', () => {
    const flat = routeIsochrone({ ...base, waves: steadySea(0.2, 90) });
    const rough = routeIsochrone({ ...base, waves: steadySea(3.5, 90) });
    expect(flat.reachedDestination).toBe(true);
    expect(rough.reachedDestination).toBe(true);
    expect(rough.etaHours).toBeGreaterThan(flat.etaHours);
  });

  it('reports the sea each leg was sailed in, and the worst of it', () => {
    const route = routeIsochrone({ ...base, waves: steadySea(2.5, 90) });
    const sailed = route.legs.filter((l) => l.waveHeightM !== null);
    expect(sailed.length).toBeGreaterThan(0);
    expect(route.maxWaveHeightM).toBeCloseTo(2.5, 6);
    expect(sailed[0].wavePeriodS).toBe(8);
    // Steering east into a sea from the east is a head sea.
    expect(sailed[0].waveAngleDeg).toBeLessThan(60);
  });

  it('says the timings are wind-only where the marine forecast does not reach', () => {
    const route = routeIsochrone({ ...base, waves: () => null });
    expect(route.maxWaveHeightM).toBeNull();
    expect(route.warnings.some((w) => w.includes('No sea state covered this passage'))).toBe(true);
    expect(route.warnings.some((w) => w.includes('Sea state is charged'))).toBe(false);
  });

  it('will not start a passage in seas above the limit set', () => {
    const route = routeIsochrone({ ...base, waves: steadySea(4, 90), maxWaveHeightM: 2.5 });
    expect(route.reachedDestination).toBe(false);
    expect(route.legs.length).toBeLessThanOrEqual(1);
    expect(route.warnings.some((w) => w.includes('already above the 2.5 m limit'))).toBe(true);
    // And is not also told the wind was against it, which it was not.
    expect(route.warnings.some((w) => w.includes('dead against this passage'))).toBe(false);
  });

  it('sails around a rough patch rather than through it', () => {
    // A patch of gale seas sitting on the rhumb line halfway along, with calm
    // water round it and at both ends of the passage.
    const patch: WaveSampler = (lat, lon) => ({
      heightM: Math.hypot(lat - 40, lon + 68) < 0.6 ? 5 : 0.5,
      directionDeg: 90,
      periodS: 8
    });
    const route = routeIsochrone({
      ...base,
      waves: patch,
      maxWaveHeightM: 3,
      maxHours: 120
    });
    expect(route.reachedDestination).toBe(true);
    expect(route.maxWaveHeightM).toBeLessThanOrEqual(3);
    // Getting round it costs miles the great circle would not have.
    expect(route.distanceNm).toBeGreaterThan(route.directDistanceNm);
  });

  it('warns about the limit it was given, and how coarsely it was applied', () => {
    const route = routeIsochrone({ ...base, waves: steadySea(1, 90), maxWaveHeightM: 3 });
    expect(route.warnings.some((w) => w.includes('kept out of seas above 3 m'))).toBe(true);
  });
});
