import type { WindSample, WindSampler } from './routing.js';
export interface Bounds {
    north: number;
    south: number;
    east: number;
    west: number;
}
export interface WindField {
    /** The model this field came from, as Open-Meteo names it. */
    model: string;
    lats: number[];
    lons: number[];
    /** Epoch ms for each forecast hour. */
    times: number[];
    /** u[timeIndex][latIndex][lonIndex] — eastward component, knots. */
    u: number[][][];
    /** v[timeIndex][latIndex][lonIndex] — northward component, knots. */
    v: number[][][];
    /**
     * gust[timeIndex][latIndex][lonIndex] — gust speed, knots. NaN where the
     * model gave none.
     *
     * Carried but never routed on: a boat does not sail its polar in a gust, it
     * reefs for one. The number a passage summary wants is the worst gust it
     * will see, which is what decides how the boat is set up, not how fast it
     * goes. Costs nothing to fetch — Open-Meteo meters coordinates, not
     * variables, so an extra hourly field rides along on a grid already paid for.
     */
    gust: number[][][];
}
export interface WindFieldOptions {
    /** Grid spacing in degrees. Default 1°, about 60 nm. */
    resolutionDeg?: number;
    /** Forecast horizon in days, capped by what the model publishes. Default 7. */
    days?: number;
    /** Degrees of margin around the passage, so a detour stays inside the grid. Default 2°. */
    marginDeg?: number;
    /**
     * Which forecast model to ask for, as Open-Meteo names it. Default
     * 'best_match', which is what the app has always used.
     *
     * Requested one model per call rather than several in one, which the API
     * also allows. That is deliberate: a multi-model response renames every
     * variable to carry the model as a suffix, and this code has been bitten
     * before by parsing a response shape nobody had ever seen. One model per
     * request keeps the shape identical to the one already verified against the
     * live API, and lets a second model fail on its own without taking the
     * first down with it.
     */
    model?: string;
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
