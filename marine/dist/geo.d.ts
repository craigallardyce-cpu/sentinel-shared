/**
 * Geodesic and geometric navigation utilities shared across the Mariner
 * Sentinel fleet.
 *
 * Distance functions are unit-explicit by name (Meters/Feet/NM) rather than
 * a single ambiguous `calculateDistance` — a prior bare version of this
 * function returned feet in one app and nautical miles in another, and a
 * downstream caller (calculateXTE) silently assumed nautical miles while
 * receiving feet, producing near-zero cross-track error at any real
 * distance. That call site is fixed here by depending on the explicitly
 * named function it actually needs.
 */
export interface Coordinates {
    latitude: number;
    longitude: number;
}
export declare function toRadians(degrees: number): number;
export declare function toDegrees(radians: number): number;
/** Haversine great-circle distance between two points, in meters. */
export declare function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** Haversine great-circle distance between two points, in feet. */
export declare function calculateDistanceFeet(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** Haversine great-circle distance between two points, in nautical miles. */
export declare function calculateDistanceNM(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** Calculates initial bearing from point 1 to point 2. Returns degrees [0, 360). */
export declare function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number;
/** Normalizes a bearing to the range [0, 360). */
export declare function normalizeBearing(bearing: number): number;
/** Checks if a bearing is within a sector defined by a center bearing and total width. */
export declare function isWithinSector(bearing: number, center: number, width: number): boolean;
/** Ray-casting point-in-polygon test. Polygon vertices are [lat, lon] pairs. */
export declare function isPointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean;
/** Simple bounding box containment test. */
export declare function isPointInBbox(lat: number, lon: number, bbox: {
    west: number;
    east: number;
    south: number;
    north: number;
}): boolean;
/** Returns the 16-point cardinal direction string for a bearing in degrees. */
export declare function getCardinalDirection(degrees: number): string;
/**
 * Calculates the destination point (e.g. an anchor position) given a start
 * point, a bearing (degrees), and a distance (feet).
 */
export declare function calculateAnchorPosition(startLat: number, startLon: number, bearingDeg: number, distanceFeet: number): Coordinates;
/**
 * Calculates the minimum distance (in feet) from a point to any coordinate
 * within a GeoJSON geometry object.
 */
export declare function getGeometryDistance(geometry: any, lat: number, lon: number): number | null;
export declare function getMaxScaleDenominator(zoom: number): number;
export declare function getTargetScaleRange(zoom: number): {
    min: number;
    max: number;
};
/** Calculates whether the vessel has passed the waypoint (perpendicular to the leg bearing). */
export declare function hasPassedWaypoint(prevLat: number, prevLon: number, currentLat: number, currentLon: number, vesselLat: number, vesselLon: number): boolean;
/** Calculates Cross Track Error (XTE) in nautical miles and steering direction. */
export declare function calculateXTE(startLat: number, startLon: number, endLat: number, endLon: number, currentLat: number, currentLon: number): {
    distance: number;
    steerDir: 'L' | 'R';
};
/** Generates a standard NMEA 0183 RMB sentence. */
export declare function generateRmbSentence(status?: string, xte?: number, steerDir?: string, originWp?: string, destWp?: string, destLat?: number, destLon?: number, range?: number, bearing?: number, velocity?: number, arrivalStatus?: string): string;
