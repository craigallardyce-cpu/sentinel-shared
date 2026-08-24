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

const CELL = 1; // degrees
const cellKey = (cx: number, cy: number) => cx * 1000 + cy;

/** Normalise either ring shape to a flat Float64Array of lon,lat pairs. */
function toFlat(ring: ObstacleRing): Float64Array {
  if (ring.length && Array.isArray(ring[0])) {
    const pairs = ring as number[][];
    const out = new Float64Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++) {
      out[i * 2] = pairs[i][0];
      out[i * 2 + 1] = pairs[i][1];
    }
    return out;
  }
  return Float64Array.from(ring as number[]);
}

interface Poly {
  zone: ObstacleZone;
  rings: Float64Array[];
  points: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function ringContains(ring: Float64Array, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and not inside any hole. */
function polyContains(poly: Poly, x: number, y: number): boolean {
  if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) return false;
  if (!ringContains(poly.rings[0], x, y)) return false;
  for (let h = 1; h < poly.rings.length; h++) {
    if (ringContains(poly.rings[h], x, y)) return false;
  }
  return true;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (by - ay) * (cx - bx) - (bx - ax) * (cy - by);

const within = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);

/**
 * Do segments AB and CD intersect? Collinear touching counts — a leg that
 * grazes a coastline edge is not one to wave through.
 */
function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const d1 = orient(ax, ay, bx, by, cx, cy);
  const d2 = orient(ax, ay, bx, by, dx, dy);
  const d3 = orient(cx, cy, dx, dy, ax, ay);
  const d4 = orient(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && within(ax, ay, bx, by, cx, cy)) return true;
  if (d2 === 0 && within(ax, ay, bx, by, dx, dy)) return true;
  if (d3 === 0 && within(cx, cy, dx, dy, ax, ay)) return true;
  if (d4 === 0 && within(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

const EMPTY: ObstacleField = {
  count: 0,
  contains: () => null,
  blocks: () => null
};

/**
 * A polygon small enough that testing whether it swallows a whole leg is free.
 *
 * A leg that lies entirely inside a polygon crosses none of its edges, so
 * edge tests alone would miss it. For a drawn zone or a small island that
 * case is real and the containment test is cheap. For a continent it cannot
 * arise: the router starts at sea and rejects any leg that crosses a
 * coastline edge, so the frontier can never get ashore in the first place.
 */
const SWALLOW_TEST_MAX_POINTS = 4000;

export function createObstacleField(zones: ObstacleZone[]): ObstacleField {
  const polys: Poly[] = [];
  for (const zone of zones) {
    if (!zone?.rings?.length) continue;
    const rings = zone.rings.map(toFlat).filter((r) => r.length >= 8);
    if (!rings.length) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let points = 0;
    for (const ring of rings) {
      points += ring.length / 2;
      for (let i = 0; i < ring.length; i += 2) {
        if (ring[i] < minX) minX = ring[i];
        if (ring[i] > maxX) maxX = ring[i];
        if (ring[i + 1] < minY) minY = ring[i + 1];
        if (ring[i + 1] > maxY) maxY = ring[i + 1];
      }
    }
    polys.push({ zone, rings, points, minX, minY, maxX, maxY });
  }
  if (!polys.length) return EMPTY;

  // Edge index. Each entry is (poly, ring, vertex) packed into three parallel
  // arrays; cells hold indices into them.
  const ePoly: number[] = [];
  const eRing: number[] = [];
  const eVert: number[] = [];
  const cells = new Map<number, number[]>();

  polys.forEach((poly, pi) => {
    poly.rings.forEach((ring, ri) => {
      const n = ring.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = ring[j * 2];
        const ay = ring[j * 2 + 1];
        const bx = ring[i * 2];
        const by = ring[i * 2 + 1];
        const id = ePoly.length;
        ePoly.push(pi);
        eRing.push(ri);
        eVert.push(j);
        const cx0 = Math.floor(Math.min(ax, bx) / CELL);
        const cx1 = Math.floor(Math.max(ax, bx) / CELL);
        const cy0 = Math.floor(Math.min(ay, by) / CELL);
        const cy1 = Math.floor(Math.max(ay, by) / CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cy = cy0; cy <= cy1; cy++) {
            const k = cellKey(cx, cy);
            let bucket = cells.get(k);
            if (!bucket) cells.set(k, (bucket = []));
            bucket.push(id);
          }
        }
      }
    });
  });

  // Polygons by bounding box, for the questions that are about an area rather
  // than a crossing: what contains this point, and what might have swallowed
  // this leg whole. The edge index cannot answer those — a leg deep inside an
  // island touches none of its edges and so gathers none of them.
  const polyCells = new Map<number, number[]>();
  polys.forEach((poly, pi) => {
    for (let cx = Math.floor(poly.minX / CELL); cx <= Math.floor(poly.maxX / CELL); cx++) {
      for (let cy = Math.floor(poly.minY / CELL); cy <= Math.floor(poly.maxY / CELL); cy++) {
        const k = cellKey(cx, cy);
        let bucket = polyCells.get(k);
        if (!bucket) polyCells.set(k, (bucket = []));
        bucket.push(pi);
      }
    }
  });

  // Reused across queries: allocating a Set per call was, at this call volume,
  // the difference between a plan and a pause.
  const seenEdge = new Int32Array(ePoly.length);
  const seenPoly = new Int32Array(polys.length);
  let stamp = 0;

  const small = polys.map((p) => p.points <= SWALLOW_TEST_MAX_POINTS);

  const polysAt = (lon: number, lat: number): number[] =>
    polyCells.get(cellKey(Math.floor(lon / CELL), Math.floor(lat / CELL))) ?? [];

  return {
    count: zones.length,

    contains(lat, lon) {
      for (const pi of polysAt(lon, lat)) {
        if (polyContains(polys[pi], lon, lat)) return polys[pi].zone;
      }
      return null;
    },

    blocks(lat1, lon1, lat2, lon2) {
      const minX = Math.min(lon1, lon2);
      const maxX = Math.max(lon1, lon2);
      const minY = Math.min(lat1, lat2);
      const maxY = Math.max(lat1, lat2);
      stamp++;

      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
          const bucket = cells.get(cellKey(cx, cy));
          if (!bucket) continue;
          for (const id of bucket) {
            if (seenEdge[id] === stamp) continue;
            seenEdge[id] = stamp;
            const poly = polys[ePoly[id]];
            const ring = poly.rings[eRing[id]];
            const j = eVert[id];
            const n = ring.length / 2;
            const i = (j + 1) % n;
            if (segmentsIntersect(
              lon1, lat1, lon2, lat2,
              ring[j * 2], ring[j * 2 + 1], ring[i * 2], ring[i * 2 + 1]
            )) return poly.zone;
          }
        }
      }

      // No edge crossed. A small polygon could still have swallowed the leg
      // whole; a continent could not — see SWALLOW_TEST_MAX_POINTS.
      stamp++;
      for (const pi of polysAt(lon2, lat2)) {
        if (!small[pi] || seenPoly[pi] === stamp) continue;
        seenPoly[pi] = stamp;
        if (polyContains(polys[pi], lon2, lat2)) return polys[pi].zone;
      }
      return null;
    }
  };
}

/**
 * Build a zone from a skipper's drawn polygon.
 *
 * Drawn points arrive in [lat, lon] because that is what the chart works in;
 * zones are stored [lon, lat] because that is what GeoJSON and every polygon
 * routine here expects. Getting that backwards puts a Solent no-go zone off
 * the coast of Somalia, so the conversion lives in exactly one place: here.
 */
export function userZone(id: string, name: string, points: Array<[number, number]>): ObstacleZone | null {
  if (!points || points.length < 3) return null;
  const ring: number[][] = points.map(([lat, lon]) => [lon, lat]);
  const [fx, fy] = ring[0];
  const last = ring[ring.length - 1];
  if (last[0] !== fx || last[1] !== fy) ring.push([fx, fy]);
  return { id, name, kind: 'user', rings: [ring] };
}

/**
 * The shipped coastline as obstacle zones.
 *
 * `landmask.json` is an array of polygons, each an array of flat rings, outer
 * ring first. One zone per polygon so a blocked route can name the landmass
 * that stopped it rather than saying only "land".
 */
export function landZones(polygons: number[][][]): ObstacleZone[] {
  return polygons.map((rings, i) => ({
    id: `land:${i}`,
    kind: 'land' as const,
    rings
  }));
}
