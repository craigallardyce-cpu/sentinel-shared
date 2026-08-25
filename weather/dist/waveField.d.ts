import type { WaveSampler } from './routing.js';
import type { Bounds } from './windField.js';
export interface WaveField {
    lats: number[];
    lons: number[];
    /** Epoch ms for each forecast hour. */
    times: number[];
    /** height[timeIndex][latIndex][lonIndex] — significant wave height, metres. NaN where not sea. */
    height: number[][][];
    /** u[timeIndex][latIndex][lonIndex] — eastward component of the wave direction unit vector. */
    u: number[][][];
    /** v[timeIndex][latIndex][lonIndex] — northward component of the wave direction unit vector. */
    v: number[][][];
    /** period[timeIndex][latIndex][lonIndex] — mean wave period, seconds. NaN where unknown. */
    period: number[][][];
}
export interface WaveFieldOptions {
    /** Grid spacing in degrees. Default 2°, about 120 nm. */
    resolutionDeg?: number;
    /** Forecast horizon in days, capped at what the marine models publish. Default 7. */
    days?: number;
    /** Injectable for tests. */
    fetchImpl?: typeof fetch;
}
/**
 * A wave direction to a unit vector.
 *
 * `wave_direction` is the direction the sea is running FROM, the same
 * meteorological convention `wind_direction_10m` uses, so the two can be
 * compared without either being flipped first. Only the direction is carried
 * as a vector: height is interpolated separately, because a big sea from the
 * north meeting a small one from the south should average to a small confused
 * sea, not to the vector sum of two heights.
 */
export declare function waveToComponents(directionFromDeg: number): {
    u: number;
    v: number;
};
/** A direction unit vector back to the direction the sea runs FROM. */
export declare function waveFromComponents(u: number, v: number): number;
/**
 * Fetch the wave grid for a passage.
 *
 * The request is shaped exactly like the wind field's — many coordinates in
 * one call, one forecast object per point, in request order — because that is
 * the response shape this codebase has actually seen from Open-Meteo. The
 * single-point case still comes back as a bare object rather than an array of
 * one, which is why both are accepted.
 */
export declare function fetchWaveField(bounds: Bounds, options?: WaveFieldOptions): Promise<WaveField>;
/**
 * A sampler over a fetched field, for the router to call.
 *
 * Outside the grid in space or time it returns null, like the wind sampler,
 * and for the same reason: sea state assumed to continue past the edge of the
 * forecast is sea state nobody forecast.
 *
 * Inside the grid it is more forgiving than the wind sampler in one specific
 * way. A cell with a land corner has no wave value there, and refusing to
 * interpolate would leave every coastal passage — which is most of them — with
 * no sea state at all. So the corners that are sea are used, reweighted to sum
 * to one, and only a cell with no sea corners at all returns null. What that
 * gives near a coast is the open-water sea state nearby, which is the honest
 * thing to say about it: not that a shore is smooth, but that this is the sea
 * running outside it.
 */
export declare function createWaveSampler(field: WaveField): WaveSampler;
