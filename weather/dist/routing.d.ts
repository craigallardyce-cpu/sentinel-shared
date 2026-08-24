import { type PolarDiagram } from './polars.js';
import type { ObstacleField } from './obstacles.js';
/** Great-circle distance in nautical miles. */
export declare function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** Initial great-circle bearing in degrees. */
export declare function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** The point reached by steering a bearing for a distance. */
export declare function destinationPoint(lat: number, lon: number, bearing: number, distNm: number): {
    lat: number;
    lon: number;
};
/** Smallest angle between two bearings, 0-180. */
export declare function angleBetween(a: number, b: number): number;
export interface WindSample {
    speedKts: number;
    /** Direction the wind is coming FROM, in degrees true. */
    directionDeg: number;
}
/** Wind at a place and moment, or null where the forecast does not reach. */
export type WindSampler = (lat: number, lon: number, timeMs: number) => WindSample | null;
export interface RouteLeg {
    lat: number;
    lon: number;
    /** ISO time of arrival at this point. */
    time: string;
    headingDeg: number;
    twaDeg: number;
    twsKts: number;
    boatSpeedKts: number;
    distanceNm: number;
    /** True where the boat changes tack or gybe relative to the previous leg. */
    manoeuvre: 'tack' | 'gybe' | null;
}
export interface RouteResult {
    reachedDestination: boolean;
    legs: RouteLeg[];
    /** Sailing time from departure to arrival, in hours. */
    etaHours: number;
    /** Distance actually sailed. */
    distanceNm: number;
    /** Great-circle distance, for comparison. */
    directDistanceNm: number;
    warnings: string[];
    polarName: string;
}
export interface RouteOptions {
    start: {
        lat: number;
        lon: number;
    };
    destination: {
        lat: number;
        lon: number;
    };
    /** Departure time, epoch ms. */
    departure: number;
    polar: PolarDiagram;
    wind: WindSampler;
    /** Simulation step. Shorter is more accurate and slower. Default 60. */
    stepMinutes?: number;
    /** Headings tried from each point. Default 10°. */
    headingResolutionDeg?: number;
    /** Give up after this long. Default 240 (ten days). */
    maxHours?: number;
    /** Frontier pruning resolution: one survivor per bearing bin. Default 2°. */
    sectorWidthDeg?: number;
    /**
     * Time cost charged for each tack or gybe. Without one the search gybes
     * every step to chase a fractionally better angle, producing a route no crew
     * would sail. Default 2 minutes, about right for a cruising boat with a
     * short-handed watch. Set 0 for a paper-optimal route.
     */
    manoeuvrePenaltyMinutes?: number;
    /**
     * Ignore headings more than this far off the bearing to the destination.
     * Wide enough for upwind tacking; narrow enough to stop the search sailing
     * away from where it is going. Default 110°.
     */
    maxOffCourseDeg?: number;
    /**
     * Polygons the route may not cross: the coastline, and any zone the skipper
     * has put off limits. A leg that would cross one is discarded during the
     * search rather than trimmed afterwards, so the boat sails around an
     * obstruction the way it actually would instead of being handed a route
     * with a corner cut off it.
     *
     * Clearing these polygons is NOT navigational safety — see obstacles.ts.
     * The warnings this returns keep saying so.
     */
    obstacles?: ObstacleField;
}
/**
 * Compute a weather-optimal route.
 *
 * Returns the best route found even when the destination is not reached — a
 * frontier that stalls in a calm or runs past `maxHours` still says something
 * useful about the passage, and `reachedDestination` reports which happened.
 */
export declare function routeIsochrone(options: RouteOptions): RouteResult;
