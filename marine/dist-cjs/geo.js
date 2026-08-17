"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRadians = toRadians;
exports.toDegrees = toDegrees;
exports.calculateDistanceMeters = calculateDistanceMeters;
exports.calculateDistanceFeet = calculateDistanceFeet;
exports.calculateDistanceNM = calculateDistanceNM;
exports.calculateBearing = calculateBearing;
exports.normalizeBearing = normalizeBearing;
exports.isWithinSector = isWithinSector;
exports.isPointInPolygon = isPointInPolygon;
exports.isPointInBbox = isPointInBbox;
exports.getCardinalDirection = getCardinalDirection;
exports.calculateAnchorPosition = calculateAnchorPosition;
exports.getGeometryDistance = getGeometryDistance;
exports.getMaxScaleDenominator = getMaxScaleDenominator;
exports.getTargetScaleRange = getTargetScaleRange;
exports.hasPassedWaypoint = hasPassedWaypoint;
exports.calculateXTE = calculateXTE;
exports.generateRmbSentence = generateRmbSentence;
const EARTH_RADIUS_METERS = 6371000;
const METERS_TO_FEET = 3.280839895;
const METERS_TO_NM = 1 / 1852;
const FEET_TO_METERS = 0.3048;
function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}
function toDegrees(radians) {
    return (radians * 180) / Math.PI;
}
/** Haversine great-circle distance between two points, in meters. */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
            Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}
/** Haversine great-circle distance between two points, in feet. */
function calculateDistanceFeet(lat1, lon1, lat2, lon2) {
    return calculateDistanceMeters(lat1, lon1, lat2, lon2) * METERS_TO_FEET;
}
/** Haversine great-circle distance between two points, in nautical miles. */
function calculateDistanceNM(lat1, lon1, lat2, lon2) {
    return calculateDistanceMeters(lat1, lon1, lat2, lon2) * METERS_TO_NM;
}
/** Calculates initial bearing from point 1 to point 2. Returns degrees [0, 360). */
function calculateBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRadians(lon2 - lon1)) * Math.cos(toRadians(lat2));
    const x = Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
        Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(toRadians(lon2 - lon1));
    const brng = toDegrees(Math.atan2(y, x));
    return (brng + 360) % 360;
}
/** Normalizes a bearing to the range [0, 360). */
function normalizeBearing(bearing) {
    return ((bearing % 360) + 360) % 360;
}
/** Checks if a bearing is within a sector defined by a center bearing and total width. */
function isWithinSector(bearing, center, width) {
    const halfWidth = width / 2;
    const diff = ((bearing - center + 180 + 360) % 360) - 180;
    return Math.abs(diff) <= halfWidth;
}
/** Ray-casting point-in-polygon test. Polygon vertices are [lat, lon] pairs. */
function isPointInPolygon(lat, lon, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = yi > lon !== yj > lon && lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi;
        if (intersect)
            inside = !inside;
    }
    return inside;
}
/** Simple bounding box containment test. */
function isPointInBbox(lat, lon, bbox) {
    return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}
const CARDINAL_DIRECTIONS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];
/** Returns the 16-point cardinal direction string for a bearing in degrees. */
function getCardinalDirection(degrees) {
    const index = Math.round(degrees / 22.5) % 16;
    return CARDINAL_DIRECTIONS[index];
}
/**
 * Calculates the destination point (e.g. an anchor position) given a start
 * point, a bearing (degrees), and a distance (feet).
 */
function calculateAnchorPosition(startLat, startLon, bearingDeg, distanceFeet) {
    const distanceMeters = distanceFeet * FEET_TO_METERS;
    const bearingRad = toRadians(bearingDeg);
    const lat1 = toRadians(startLat);
    const lon1 = toRadians(startLon);
    const angularDist = distanceMeters / EARTH_RADIUS_METERS;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDist) + Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad));
    const lon2 = lon1 +
        Math.atan2(Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1), Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2));
    return {
        latitude: toDegrees(lat2),
        longitude: toDegrees(lon2)
    };
}
/**
 * Calculates the minimum distance (in feet) from a point to any coordinate
 * within a GeoJSON geometry object.
 */
function getGeometryDistance(geometry, lat, lon) {
    if (!geometry || !geometry.coordinates)
        return null;
    let minDistance = null;
    function traverse(coords) {
        if (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            const [pLon, pLat] = coords;
            const d = calculateDistanceFeet(lat, lon, pLat, pLon);
            if (minDistance === null || d < minDistance) {
                minDistance = d;
            }
        }
        else if (Array.isArray(coords)) {
            for (const item of coords) {
                traverse(item);
            }
        }
    }
    traverse(geometry.coordinates);
    return minDistance;
}
function getMaxScaleDenominator(zoom) {
    if (zoom >= 16)
        return 25000;
    if (zoom >= 13)
        return 80000;
    if (zoom >= 10)
        return 400000;
    return Infinity;
}
function getTargetScaleRange(zoom) {
    if (zoom >= 16)
        return { min: 0, max: 25000 };
    if (zoom >= 13)
        return { min: 25000, max: 80000 };
    if (zoom >= 10)
        return { min: 80000, max: 400000 };
    return { min: 400000, max: Infinity };
}
/** Calculates whether the vessel has passed the waypoint (perpendicular to the leg bearing). */
function hasPassedWaypoint(prevLat, prevLon, currentLat, currentLon, vesselLat, vesselLon) {
    const legBearing = calculateBearing(prevLat, prevLon, currentLat, currentLon);
    const vesselToWaypointBearing = calculateBearing(vesselLat, vesselLon, currentLat, currentLon);
    let diff = Math.abs(legBearing - vesselToWaypointBearing);
    if (diff > 180)
        diff = 360 - diff;
    return diff > 90;
}
/** Calculates Cross Track Error (XTE) in nautical miles and steering direction. */
function calculateXTE(startLat, startLon, endLat, endLon, currentLat, currentLon) {
    const R = 3440.065; // Earth radius in nautical miles
    const distStartToCurrent = calculateDistanceNM(startLat, startLon, currentLat, currentLon) / R;
    const bearingStartToCurrent = toRadians(calculateBearing(startLat, startLon, currentLat, currentLon));
    const bearingStartToEnd = toRadians(calculateBearing(startLat, startLon, endLat, endLon));
    const xteAngular = Math.asin(Math.sin(distStartToCurrent) * Math.sin(bearingStartToCurrent - bearingStartToEnd));
    const xteDistance = Math.abs(xteAngular * R);
    let angleDiff = bearingStartToCurrent - bearingStartToEnd;
    while (angleDiff > Math.PI)
        angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI)
        angleDiff += 2 * Math.PI;
    const steerDir = angleDiff > 0 ? 'L' : 'R';
    return {
        distance: xteDistance,
        steerDir
    };
}
function formatLatLonForNmea(lat, lon) {
    const latH = lat >= 0 ? 'N' : 'S';
    const lonH = lon >= 0 ? 'E' : 'W';
    const absLat = Math.abs(lat);
    const latDeg = Math.floor(absLat);
    const latMin = ((absLat - latDeg) * 60).toFixed(4).padStart(7, '0');
    const absLon = Math.abs(lon);
    const lonDeg = Math.floor(absLon);
    const lonMin = ((absLon - lonDeg) * 60).toFixed(4).padStart(7, '0');
    return {
        latStr: `${latDeg.toString().padStart(2, '0')}${latMin}`,
        latH,
        lonStr: `${lonDeg.toString().padStart(3, '0')}${lonMin}`,
        lonH
    };
}
function calculateChecksum(sentence) {
    let checksum = 0;
    for (let i = 1; i < sentence.length; i++) {
        if (sentence[i] === '*')
            break;
        checksum ^= sentence.charCodeAt(i);
    }
    return checksum.toString(16).toUpperCase().padStart(2, '0');
}
/** Generates a standard NMEA 0183 RMB sentence. */
function generateRmbSentence(status = 'A', xte = 0, steerDir = 'L', originWp = 'WP0', destWp = 'WP1', destLat = 0, destLon = 0, range = 0, bearing = 0, velocity = 0, arrivalStatus = 'V') {
    const coords = formatLatLonForNmea(destLat, destLon);
    let formattedXte = xte.toFixed(2);
    if (xte > 9.99)
        formattedXte = '9.99';
    const oWp = originWp.substring(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const dWp = destWp.substring(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rangeStr = range.toFixed(2);
    const bearingStr = bearing.toFixed(1);
    const velocityStr = velocity.toFixed(1);
    let sentence = `$ECRMB,${status},${formattedXte},${steerDir},${oWp},${dWp},${coords.latStr},${coords.latH},${coords.lonStr},${coords.lonH},${rangeStr},${bearingStr},${velocityStr},${arrivalStatus}`;
    sentence += ',A*';
    const checksum = calculateChecksum(sentence);
    return sentence + checksum;
}
