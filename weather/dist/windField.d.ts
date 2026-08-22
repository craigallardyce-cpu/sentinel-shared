import type { WindSample, WindSampler } from './routing.js';
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
export declare function boundsForPassage(start: {
    lat: number;
    lon: number;
}, destination: {
    lat: number;
    lon: number;
}, marginDeg?: number): Bounds;
/** Meteorological direction (FROM) and speed to eastward/northward components. */
export declare function toComponents(speedKts: number, directionFromDeg: number): {
    u: number;
    v: number;
};
/** Components back to speed and the direction the wind blows FROM. */
export declare function fromComponents(u: number, v: number): WindSample;
/**
 * Fetch the wind grid for a passage.
 *
 * Open-Meteo takes many coordinates in one request and answers with one
 * forecast object per point, which keeps a whole passage to a single call.
 * Grids are deliberately coarse: 1° is finer than the models resolve for
 * offshore planning, and every extra point is payload a boat may be pulling
 * over a satellite link.
 */
export declare function fetchWindField(bounds: Bounds, options?: WindFieldOptions): Promise<WindField>;
/**
 * A sampler over a fetched field, for the router to call.
 *
 * Returns null outside the grid in space or time rather than clamping to the
 * edge: a router told the wind at the boundary continues forever will happily
 * plan a passage through forecast it does not have.
 */
export declare function createWindSampler(field: WindField): WindSampler;
