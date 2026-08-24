/**
 * Polygons a route may not cross.
 *
 * Two things need this and they are the same problem, so they share one
 * implementation: the coastline, so the router stops proposing passages over
 * land, and the zones a skipper draws for themselves — a firing range, a reef
 * they will not go near at night, a fishing ground, an area a charter contract
 * puts off limits.
 *
 * What this is NOT, and the distinction matters on a boat: clearing a land
 * polygon is not the same as being navigationally safe. The coastline shipped
 * with the app is a small-scale outline simplified to about a kilometre, with
 * no depths, no rocks, no reefs, no buoyage and no traffic separation schemes.
 * A route that clears these polygons has cleared the *shape of the continent*
 * and nothing else. The router's warning says so, and it must keep saying so:
 * a route that looks checked is more dangerous than one that is obviously not.
 *
 * Performance shapes the design. The router asks `blocks()` on the order of a
 * million times per plan, against a coastline of ~150,000 vertices. Indexing
 * whole rings is not enough — Eurasia's bounding box covers a third of the
 * planet, so every leg near it would walk every one of its edges. So
 * individual EDGES are bucketed into one-degree cells and stored in typed
 * arrays: a query touches the handful of edges that could possibly be in the
 * way, and the whole coastline costs a few megabytes rather than a few hundred
 * thousand JavaScript arrays.
 */
/**
 * A ring of coordinates, either as [lon, lat] pairs (what GeoJSON and a
 * hand-written zone look like) or flat [lon, lat, lon, lat, …] (what the
 * shipped coastline uses, to keep its JSON small). Both are accepted so the
 * big dataset never has to be re-shaped into pair arrays just to be read.
 *
 * Note the axis order: longitude first. Chart code works in lat/lon and this
 * does not, which is exactly why `userZone()` exists.
 */
export type ObstacleRing = number[][] | number[];
export interface ObstacleZone {
    id: string;
    name?: string;
    /** 'land' is the shipped coastline; 'user' is a zone the skipper drew. */
    kind: 'land' | 'user';
    /** Outer ring first, holes after. */
    rings: ObstacleRing[];
}
export interface ObstacleField {
    /** Zones in the field. Zero means every query answers null, cheaply. */
    readonly count: number;
    /** The zone containing this position, or null. */
    contains(lat: number, lon: number): ObstacleZone | null;
    /** The zone this leg would cross or end inside, or null. */
    blocks(lat1: number, lon1: number, lat2: number, lon2: number): ObstacleZone | null;
}
export declare function createObstacleField(zones: ObstacleZone[]): ObstacleField;
/**
 * Build a zone from a skipper's drawn polygon.
 *
 * Drawn points arrive in [lat, lon] because that is what the chart works in;
 * zones are stored [lon, lat] because that is what GeoJSON and every polygon
 * routine here expects. Getting that backwards puts a Solent no-go zone off
 * the coast of Somalia, so the conversion lives in exactly one place: here.
 */
export declare function userZone(id: string, name: string, points: Array<[number, number]>): ObstacleZone | null;
/**
 * The shipped coastline as obstacle zones.
 *
 * `landmask.json` is an array of polygons, each an array of flat rings, outer
 * ring first. One zone per polygon so a blocked route can name the landmass
 * that stopped it rather than saying only "land".
 */
export declare function landZones(polygons: number[][][]): ObstacleZone[];
