import type { WindSample, WindSampler } from './routing.js';

/**
 * The wind the router sails through: a grid of forecasts over the passage area,
 * sampled continuously in space and time.
 *
 * Fetched once for the whole passage and held in memory, so a route can be
 * recomputed — a different departure time, a different polar — without going
 * back to the network. That is what lets routing run at sea on cached data.
 *
 * Wind is interpolated as vectors, never as degrees. Averaging 350° and 10°
 * arithmetically gives 180°, a southerly reported in a northerly breeze, and a
 * router fed that would confidently sail the wrong way.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 20_000;

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface WindField {
  lats: number[];
  lons: number[];
  /** Epoch ms for each forecast hour. */
  times: number[];
  /** u[timeIndex][latIndex][lonIndex] — eastward component, knots. */
  u: number[][][];
  /** v[timeIndex][latIndex][lonIndex] — northward component, knots. */
  v: number[][][];
}

export interface WindFieldOptions {
  /** Grid spacing in degrees. Default 1°, about 60 nm. */
  resolutionDeg?: number;
  /** Forecast horizon in days, capped by what the model publishes. Default 7. */
  days?: number;
  /** Degrees of margin around the passage, so a detour stays inside the grid. Default 2°. */
  marginDeg?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** The area a passage needs wind for, with room to detour around weather. */
export function boundsForPassage(
  start: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  marginDeg = 2
): Bounds {
  return {
    north: Math.min(90, Math.max(start.lat, destination.lat) + marginDeg),
    south: Math.max(-90, Math.min(start.lat, destination.lat) - marginDeg),
    east: Math.min(180, Math.max(start.lon, destination.lon) + marginDeg),
    west: Math.max(-180, Math.min(start.lon, destination.lon) - marginDeg)
  };
}

function axis(from: number, to: number, stepDeg: number): number[] {
  const values: number[] = [];
  for (let v = from; v <= to + 1e-9; v += stepDeg) values.push(Math.round(v * 1000) / 1000);
  if (values.length === 0) values.push(from);
  return values;
}

/** Meteorological direction (FROM) and speed to eastward/northward components. */
export function toComponents(speedKts: number, directionFromDeg: number): { u: number; v: number } {
  const rad = (directionFromDeg * Math.PI) / 180;
  return { u: -speedKts * Math.sin(rad), v: -speedKts * Math.cos(rad) };
}

/** Components back to speed and the direction the wind blows FROM. */
export function fromComponents(u: number, v: number): WindSample {
  const speedKts = Math.hypot(u, v);
  const directionDeg = (((Math.atan2(-u, -v) * 180) / Math.PI) + 360) % 360;
  return { speedKts, directionDeg };
}

/**
 * Fetch the wind grid for a passage.
 *
 * Open-Meteo takes many coordinates in one request and answers with one
 * forecast object per point, which keeps a whole passage to a single call.
 * Grids are deliberately coarse: 1° is finer than the models resolve for
 * offshore planning, and every extra point is payload a boat may be pulling
 * over a satellite link.
 */
export async function fetchWindField(
  bounds: Bounds,
  options: WindFieldOptions = {}
): Promise<WindField> {
  const { resolutionDeg = 1, days = 7, fetchImpl = fetch } = options;

  const lats = axis(bounds.south, bounds.north, resolutionDeg);
  const lons = axis(bounds.west, bounds.east, resolutionDeg);

  const latParam: number[] = [];
  const lonParam: number[] = [];
  for (const la of lats) for (const lo of lons) { latParam.push(la); lonParam.push(lo); }

  const url =
    `${FORECAST_URL}?latitude=${latParam.join(',')}&longitude=${lonParam.join(',')}` +
    '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn' +
    `&forecast_days=${Math.min(16, Math.max(1, Math.round(days)))}&models=best_match`;

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo wind field returned HTTP ${res.status}`);
  const payload = await res.json();

  // One coordinate comes back as an object, many as an array.
  const points: any[] = Array.isArray(payload) ? payload : [payload];
  if (points.length !== lats.length * lons.length) {
    throw new Error(
      `Open-Meteo returned ${points.length} forecast points for a ${lats.length}x${lons.length} grid.`
    );
  }

  const timeStrings: string[] = points[0]?.hourly?.time ?? [];
  if (!timeStrings.length) throw new Error('Open-Meteo wind field contained no hourly data.');
  // Upstream times carry no zone suffix and default to GMT.
  const times = timeStrings.map((t) => Date.parse(/[Zz+]/.test(t) ? t : `${t}Z`));

  const u: number[][][] = [];
  const v: number[][][] = [];
  for (let t = 0; t < times.length; t++) {
    const uPlane: number[][] = [];
    const vPlane: number[][] = [];
    for (let i = 0; i < lats.length; i++) {
      const uRow: number[] = [];
      const vRow: number[] = [];
      for (let j = 0; j < lons.length; j++) {
        const point = points[i * lons.length + j];
        const speed = point?.hourly?.wind_speed_10m?.[t];
        const dir = point?.hourly?.wind_direction_10m?.[t];
        if (Number.isFinite(speed) && Number.isFinite(dir)) {
          const c = toComponents(speed, dir);
          uRow.push(c.u);
          vRow.push(c.v);
        } else {
          uRow.push(NaN);
          vRow.push(NaN);
        }
      }
      uPlane.push(uRow);
      vPlane.push(vRow);
    }
    u.push(uPlane);
    v.push(vPlane);
  }

  return { lats, lons, times, u, v };
}

function slot(values: number[], target: number): { lo: number; hi: number; frac: number } | null {
  if (!values.length) return null;
  if (target < values[0] || target > values[values.length - 1]) return null;
  let hi = 1;
  while (hi < values.length - 1 && values[hi] < target) hi++;
  const lo = hi - 1;
  const span = values[hi] - values[lo];
  return { lo, hi, frac: span === 0 ? 0 : (target - values[lo]) / span };
}

/**
 * A sampler over a fetched field, for the router to call.
 *
 * Returns null outside the grid in space or time rather than clamping to the
 * edge: a router told the wind at the boundary continues forever will happily
 * plan a passage through forecast it does not have.
 */
export function createWindSampler(field: WindField): WindSampler {
  return (lat: number, lon: number, timeMs: number): WindSample | null => {
    const y = slot(field.lats, lat);
    const x = slot(field.lons, lon);
    const t = slot(field.times, timeMs);
    if (!y || !x || !t) return null;

    const at = (ti: number, yi: number, xi: number) => ({
      u: field.u[ti]?.[yi]?.[xi],
      v: field.v[ti]?.[yi]?.[xi]
    });

    const blend = (ti: number) => {
      const c00 = at(ti, y.lo, x.lo);
      const c01 = at(ti, y.lo, x.hi);
      const c10 = at(ti, y.hi, x.lo);
      const c11 = at(ti, y.hi, x.hi);
      const values = [c00, c01, c10, c11];
      if (values.some((c) => !Number.isFinite(c.u) || !Number.isFinite(c.v))) return null;
      const low = {
        u: c00.u! + (c01.u! - c00.u!) * x.frac,
        v: c00.v! + (c01.v! - c00.v!) * x.frac
      };
      const high = {
        u: c10.u! + (c11.u! - c10.u!) * x.frac,
        v: c10.v! + (c11.v! - c10.v!) * x.frac
      };
      return {
        u: low.u + (high.u - low.u) * y.frac,
        v: low.v + (high.v - low.v) * y.frac
      };
    };

    const before = blend(t.lo);
    const after = blend(t.hi);
    if (!before || !after) return null;

    return fromComponents(
      before.u + (after.u - before.u) * t.frac,
      before.v + (after.v - before.v) * t.frac
    );
  };
}
