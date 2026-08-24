import { describe, it, expect } from 'vitest';
import { createObstacleField, userZone, type ObstacleZone } from '../src/obstacles.js';
import { routeIsochrone } from '../src/routing.js';
import { GENERIC_POLARS } from '../src/polars.js';

/** A square island, [lon, lat] ring order. */
const island = (id: string, minLon: number, minLat: number, maxLon: number, maxLat: number): ObstacleZone => ({
  id,
  name: id,
  kind: 'land',
  rings: [[
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat]
  ]]
});

describe('createObstacleField', () => {
  const field = createObstacleField([island('block', -1, -1, 1, 1)]);

  it('reports a position inside the polygon', () => {
    expect(field.contains(0, 0)?.id).toBe('block');
  });

  it('reports nothing for a position outside it', () => {
    expect(field.contains(5, 5)).toBeNull();
  });

  it('blocks a leg that crosses the polygon', () => {
    expect(field.blocks(0, -3, 0, 3)?.id).toBe('block');
  });

  it('allows a leg that passes clear of it', () => {
    expect(field.blocks(5, -3, 5, 3)).toBeNull();
  });

  it('blocks a leg that ends inside it without crossing an edge', () => {
    expect(field.blocks(0.2, 0.2, 0.4, 0.4)?.id).toBe('block');
  });

  it('blocks a leg that only clips a corner, both ends outside', () => {
    // Cuts inside the (1,1) corner: the chord lon+lat = 1.8 passes within the
    // corner at lon+lat = 2, while both endpoints are clear of the square.
    expect(field.blocks(0.6, 1.2, 1.2, 0.6)?.id).toBe('block');
  });

  it('allows a leg that passes just outside the same corner', () => {
    expect(field.blocks(0.9, 1.5, 1.5, 0.9)).toBeNull();
  });

  it('is empty and cheap when given no zones', () => {
    const empty = createObstacleField([]);
    expect(empty.count).toBe(0);
    expect(empty.blocks(0, 0, 1, 1)).toBeNull();
  });

  it('respects holes: a lagoon inside an atoll is not blocked', () => {
    const atoll: ObstacleZone = {
      id: 'atoll',
      kind: 'land',
      rings: [
        [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],
        [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
      ]
    };
    const withHole = createObstacleField([atoll]);
    expect(withHole.contains(0, 0)).toBeNull();
    expect(withHole.contains(1.5, 1.5)?.id).toBe('atoll');
  });
});

describe('userZone', () => {
  it('converts drawn lat/lon points into [lon, lat] ring order', () => {
    const zone = userZone('z1', 'Firing range', [[10, 20], [10, 21], [11, 21]]);
    expect(zone?.rings[0][0]).toEqual([20, 10]);
    expect(zone?.kind).toBe('user');
  });

  it('closes an open ring', () => {
    const zone = userZone('z1', 'x', [[0, 0], [0, 1], [1, 1]]);
    const ring = zone!.rings[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('refuses fewer than three points, which is not an area', () => {
    expect(userZone('z1', 'x', [[0, 0], [1, 1]])).toBeNull();
  });

  it('blocks a route through a drawn zone', () => {
    const zone = userZone('z1', 'Keep out', [[-1, -1], [-1, 1], [1, 1], [1, -1]])!;
    const field = createObstacleField([zone]);
    expect(field.blocks(0, -2, 0, 2)?.name).toBe('Keep out');
  });
});

describe('routeIsochrone with obstacles', () => {
  // Steady 15 kt westerly, so a boat can sail east on a broad reach.
  const wind = () => ({ speedKts: 15, directionDeg: 270 });
  const polar = GENERIC_POLARS.cruisingMonohull;
  const departure = Date.UTC(2026, 0, 1, 0, 0, 0);

  const base = {
    start: { lat: 0, lon: 0 },
    destination: { lat: 0, lon: 3 },
    departure,
    polar,
    wind,
    maxHours: 96
  };

  it('sails straight through when nothing is in the way', () => {
    const route = routeIsochrone(base);
    expect(route.reachedDestination).toBe(true);
    const maxLat = Math.max(...route.legs.map((l) => Math.abs(l.lat)));
    expect(maxLat).toBeLessThan(0.35);
  });

  it('goes around an island squarely in the way', () => {
    const obstacles = createObstacleField([island('mid', 1.2, -0.4, 1.8, 0.4)]);
    const route = routeIsochrone({ ...base, obstacles });
    expect(route.reachedDestination).toBe(true);
    // Every leg must be clear of the island.
    for (const leg of route.legs) {
      expect(obstacles.contains(leg.lat, leg.lon)).toBeNull();
    }
    // And it had to deviate to do it.
    const maxLat = Math.max(...route.legs.map((l) => Math.abs(l.lat)));
    expect(maxLat).toBeGreaterThan(0.35);
  });

  it('says the check was coarse rather than claiming the route is safe', () => {
    const obstacles = createObstacleField([island('mid', 1.2, -0.4, 1.8, 0.4)]);
    const route = routeIsochrone({ ...base, obstacles });
    const warning = route.warnings[0];
    expect(warning).toMatch(/depths, rocks/);
    expect(warning).not.toMatch(/kilometre/); // no precision claim that can drift from the build
    expect(warning).toMatch(/check every leg against your chart/i);
  });

  it('keeps the original warning when no obstacles are supplied', () => {
    expect(routeIsochrone(base).warnings[0]).toMatch(/does not know where land/);
  });

  it('does not reach a destination walled off from the sea', () => {
    const walled = createObstacleField([island('wall', 2.0, -20, 2.2, 20)]);
    const route = routeIsochrone({ ...base, obstacles: walled, maxHours: 48 });
    expect(route.reachedDestination).toBe(false);
    for (const leg of route.legs) {
      expect(walled.contains(leg.lat, leg.lon)).toBeNull();
    }
  });
});

describe('routeIsochrone with an end inside an obstacle', () => {
  const wind = () => ({ speedKts: 15, directionDeg: 270 });
  const polar = GENERIC_POLARS.cruisingMonohull;
  const departure = Date.UTC(2026, 0, 1);
  const obstacles = createObstacleField([island('rock', 2.8, -0.2, 3.2, 0.2)]);

  it('says the destination is on land instead of wandering', () => {
    const route = routeIsochrone({
      start: { lat: 0, lon: 0 },
      destination: { lat: 0, lon: 3 },
      departure, polar, wind, obstacles, maxHours: 240
    });
    expect(route.reachedDestination).toBe(false);
    expect(route.legs).toHaveLength(0);
    expect(route.warnings.join(' ')).toMatch(/destination is on land/);
  });

  it('names a user zone rather than calling it land', () => {
    const zone = userZone('z', 'Firing range', [[-0.2, 2.8], [0.2, 2.8], [0.2, 3.2], [-0.2, 3.2]])!;
    const route = routeIsochrone({
      start: { lat: 0, lon: 0 },
      destination: { lat: 0, lon: 3 },
      departure, polar, wind,
      obstacles: createObstacleField([zone]),
      maxHours: 240
    });
    expect(route.warnings.join(' ')).toMatch(/Firing range/);
  });

  it('says the start is on land', () => {
    const route = routeIsochrone({
      start: { lat: 0, lon: 3 },
      destination: { lat: 0, lon: 0 },
      departure, polar, wind, obstacles, maxHours: 240
    });
    expect(route.warnings.join(' ')).toMatch(/starting position is on land/);
  });
});

describe('why a blocked search stopped', () => {
  const polar = GENERIC_POLARS.cruisingMonohull;
  const departure = Date.UTC(2026, 0, 1);
  const base = {
    start: { lat: 0, lon: 0 },
    destination: { lat: 0, lon: 3 },
    departure, polar, maxHours: 48
  };
  // Walls a step away on three sides, leaving only west — which is behind the
  // boat and outside the search's off-course window.
  const boxedIn = createObstacleField([
    // A band, not a half-plane: a wall extending past lon 3 would contain the
    // destination, and the router would rightly refuse before sampling wind.
    island('east', 0.02, -5, 0.5, 5),
    island('north', -5, 0.02, 5, 5),
    island('south', -5, -5, 5, -0.02)
  ]);

  it('names land when every course the boat could sail runs ashore', () => {
    // Wind from the west, so east is dead downwind and north/south are beam
    // reaches: everything in the window is sailable, and all of it is walled.
    const r = routeIsochrone({ ...base, wind: () => ({ speedKts: 15, directionDeg: 270 }), obstacles: boxedIn });
    expect(r.reachedDestination).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/runs into land within one step/);
  });

  it('names the wind when land is not the problem', () => {
    // Dead headwind with the search held close to the rhumb line, so the
    // tacking angles it would normally use are out of bounds. No obstacles.
    const r = routeIsochrone({
      ...base,
      wind: () => ({ speedKts: 15, directionDeg: 90 }),
      maxOffCourseDeg: 20
    });
    expect(r.reachedDestination).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/dead against this passage/);
  });

  it('names both when what the land leaves open, the wind forbids', () => {
    // Headwind from the east; land north and south. What is sailable (the
    // tacks) is walled, and what is open (due east) is dead upwind.
    const r = routeIsochrone({
      ...base,
      wind: () => ({ speedKts: 15, directionDeg: 90 }),
      obstacles: createObstacleField([
        island('north', -5, 0.02, 5, 5),
        island('south', -5, -5, 5, -0.02)
      ])
    });
    expect(r.reachedDestination).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/no way out/);
    expect(r.warnings.join(' ')).toMatch(/pilotage/);
  });

  it('still calls a calm a calm', () => {
    const r = routeIsochrone({ ...base, wind: () => ({ speedKts: 0, directionDeg: 0 }), obstacles: boxedIn });
    expect(r.warnings.join(' ')).toMatch(/no route could be started/);
  });
});
