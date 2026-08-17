import { describe, it, expect } from 'vitest';
import {
  calculateDistanceMeters,
  calculateDistanceFeet,
  calculateDistanceNM,
  calculateBearing,
  normalizeBearing,
  isWithinSector,
  isPointInPolygon,
  isPointInBbox,
  getCardinalDirection,
  calculateAnchorPosition,
  hasPassedWaypoint,
  calculateXTE,
  generateRmbSentence
} from '../src/geo.js';
import { validateNmeaChecksum } from '../src/nmea.js';

describe('distance functions', () => {
  it('returns 0 for identical points', () => {
    expect(calculateDistanceMeters(41.5, -71.3, 41.5, -71.3)).toBe(0);
  });

  it('is symmetric', () => {
    const a = calculateDistanceMeters(41.5, -71.3, 41.6, -71.2);
    const b = calculateDistanceMeters(41.6, -71.2, 41.5, -71.3);
    expect(a).toBeCloseTo(b, 9);
  });

  it('matches the exact closed-form great-circle distance along the equator', () => {
    // At lat=0, haversine reduces exactly to R * dLon (no small-angle approximation).
    const EARTH_RADIUS_METERS = 6371000;
    const expected = EARTH_RADIUS_METERS * (Math.PI / 180);
    const actual = calculateDistanceMeters(0, 0, 0, 1);
    expect(Math.abs(actual - expected)).toBeLessThan(1);
  });

  it('keeps feet and NM variants consistent with the meters value', () => {
    // This is the exact bug class this module fixes: two apps had a bare
    // calculateDistance returning different units, and a downstream caller
    // silently assumed the wrong one. Pin the conversions down explicitly.
    const meters = calculateDistanceMeters(41.0, -71.0, 41.5, -71.5);
    const feet = calculateDistanceFeet(41.0, -71.0, 41.5, -71.5);
    const nm = calculateDistanceNM(41.0, -71.0, 41.5, -71.5);

    expect(feet).toBeCloseTo(meters * 3.280839895, 6);
    expect(nm).toBeCloseTo(meters / 1852, 9);
  });

  it('1 degree of latitude is approximately 60 nautical miles', () => {
    const nm = calculateDistanceNM(41.0, -71.0, 42.0, -71.0);
    expect(nm).toBeGreaterThan(59);
    expect(nm).toBeLessThan(61);
  });
});

describe('calculateBearing', () => {
  it('reports due north as 0 degrees', () => {
    expect(calculateBearing(0, 0, 1, 0)).toBeCloseTo(0, 6);
  });

  it('reports due east as 90 degrees', () => {
    expect(calculateBearing(0, 0, 0, 1)).toBeCloseTo(90, 6);
  });

  it('reports due south as 180 degrees', () => {
    expect(calculateBearing(1, 0, 0, 0)).toBeCloseTo(180, 6);
  });

  it('reports due west as 270 degrees', () => {
    expect(calculateBearing(0, 1, 0, 0)).toBeCloseTo(270, 6);
  });
});

describe('normalizeBearing', () => {
  it.each([
    [-10, 350],
    [370, 10],
    [360, 0],
    [0, 0],
    [180, 180],
    [-360, 0]
  ])('normalizeBearing(%d) === %d', (input, expected) => {
    expect(normalizeBearing(input)).toBeCloseTo(expected, 9);
  });
});

describe('isWithinSector', () => {
  it('accepts a bearing at the exact center', () => {
    expect(isWithinSector(90, 90, 20)).toBe(true);
  });

  it('rejects a bearing outside the sector', () => {
    expect(isWithinSector(150, 90, 20)).toBe(false);
  });

  it('handles the 0/360 wraparound correctly', () => {
    // Sector centered on 0 (north), total width 20 -> covers [350, 360) and [0, 10]
    expect(isWithinSector(355, 0, 20)).toBe(true);
    expect(isWithinSector(5, 0, 20)).toBe(true);
    expect(isWithinSector(15, 0, 20)).toBe(false);
    expect(isWithinSector(345, 0, 20)).toBe(false);
  });
});

describe('isPointInPolygon', () => {
  const square: [number, number][] = [[0, 0], [0, 10], [10, 10], [10, 0]];

  it('detects a point inside the polygon', () => {
    expect(isPointInPolygon(5, 5, square)).toBe(true);
  });

  it('detects a point outside the polygon', () => {
    expect(isPointInPolygon(20, 20, square)).toBe(false);
  });
});

describe('isPointInBbox', () => {
  const bbox = { west: -72, east: -71, south: 41, north: 42 };

  it('accepts a point inside the box', () => {
    expect(isPointInBbox(41.5, -71.5, bbox)).toBe(true);
  });

  it('rejects a point outside the box', () => {
    expect(isPointInBbox(43, -71.5, bbox)).toBe(false);
  });
});

describe('getCardinalDirection', () => {
  it.each([
    [0, 'N'],
    [45, 'NE'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
    [360, 'N']
  ])('getCardinalDirection(%d) === %s', (deg, expected) => {
    expect(getCardinalDirection(deg)).toBe(expected);
  });
});

describe('calculateAnchorPosition', () => {
  it('places the destination point at the requested distance and bearing', () => {
    const start = { lat: 41.5, lon: -71.3 };
    const distanceFeet = 300;
    const dest = calculateAnchorPosition(start.lat, start.lon, 90, distanceFeet);

    const actualFeet = calculateDistanceFeet(start.lat, start.lon, dest.latitude, dest.longitude);
    expect(actualFeet).toBeCloseTo(distanceFeet, 0);

    // Bearing due east should move longitude east (more positive) without much latitude change.
    expect(dest.longitude).toBeGreaterThan(start.lon);
    expect(Math.abs(dest.latitude - start.lat)).toBeLessThan(0.001);
  });
});

describe('hasPassedWaypoint', () => {
  it('returns false when the vessel has not yet reached the waypoint', () => {
    // Leg heads east from (0,0) to (0,1); vessel is short of the waypoint.
    expect(hasPassedWaypoint(0, 0, 0, 1, 0, 0.5)).toBe(false);
  });

  it('returns true once the vessel is beyond the waypoint', () => {
    expect(hasPassedWaypoint(0, 0, 0, 1, 0, 1.5)).toBe(true);
  });
});

describe('calculateXTE', () => {
  it('reports near-zero cross-track error exactly on the track', () => {
    const { distance } = calculateXTE(0, 0, 0, 2, 0, 1);
    expect(distance).toBeLessThan(0.001);
  });

  it('reports a plausible nautical-mile magnitude when off track', () => {
    // 0.01 degrees of latitude offset is ~0.6 NM. The bug this module fixes
    // (dividing a feet-based distance by a nautical-mile Earth radius) would
    // have produced a result off by a factor of ~6076 here.
    const { distance, steerDir } = calculateXTE(0, 0, 0, 2, 0.01, 1);
    expect(distance).toBeGreaterThan(0.3);
    expect(distance).toBeLessThan(1.0);
    expect(['L', 'R']).toContain(steerDir);
  });

  it('reports opposite steering direction for offsets on opposite sides of the track', () => {
    const north = calculateXTE(0, 0, 0, 2, 0.01, 1);
    const south = calculateXTE(0, 0, 0, 2, -0.01, 1);
    expect(north.steerDir).not.toBe(south.steerDir);
  });
});

describe('generateRmbSentence', () => {
  it('produces a sentence with a valid checksum', () => {
    const sentence = generateRmbSentence('A', 0.15, 'L', 'WP0', 'WP1', 41.5, -71.3, 2.3, 90, 6.2, 'V');
    expect(sentence.startsWith('$ECRMB,')).toBe(true);
    expect(validateNmeaChecksum(sentence)).toBe(true);
  });
});
