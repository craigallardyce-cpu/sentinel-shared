/**
 * The wind particle integrator, as worker source rather than a worker module.
 *
 * The algorithm is unchanged from the one that lived in OceanSentinel's
 * `utils/wind-worker.js`. What changed is how it is delivered.
 *
 * That file was loaded with `import WindWorker from './wind-worker?worker&inline'`
 * — a Vite-specific import specifier. Vite understands it; `tsc` does not, and
 * this package is built with `tsc`. Shipping the source as a string and
 * building the worker from a Blob at runtime keeps one copy of the maths for
 * the whole fleet without asking every consumer to bundle it a particular way.
 * It also works unchanged under Electron and in the Capacitor WebView, neither
 * of which is a Vite build at all.
 *
 * Kept as a template literal rather than a separate `.js` asset because a
 * package built by `tsc` copies nothing but the files it compiles: a sibling
 * `.js` would simply not be in `dist`.
 */
export const WIND_WORKER_SOURCE = String.raw`
let grid = null;
let particles = [];
let maxParticles = 600;
let speedScale = 0.005;
let bounds = null;

self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'init') {
    grid = data.grid;
    bounds = data.bounds;
    maxParticles = data.maxParticles || 600;
    speedScale = data.speedScale || 0.005;
    initParticles();
  } else if (type === 'grid') {
    // A new forecast hour for the SAME area, which is what the chart's time
    // scrubber produces. Swapped in place rather than re-initialising: tearing
    // the worker down and building it again reseeds every particle, so
    // stepping through a forecast flickered the whole field back to random
    // positions at each step and the wind appeared to restart rather than to
    // change. The particles carry on from where they are and simply find
    // themselves in a different wind, which is what a change of hour is.
    if (grid && data.grid) {
      grid.uGrid = data.grid.uGrid;
      grid.vGrid = data.grid.vGrid;
    }
  } else if (type === 'view') {
    // The chart pans and zooms far inside the grid, so the layer sends the visible box and a
    // step sized for it. Reseeding here is what keeps particles on screen instead of scattered
    // across the whole grid.
    if (data.bounds) bounds = data.bounds;
    if (data.speedScale) speedScale = data.speedScale;
    initParticles();
  } else if (type === 'update') {
    if (!grid) return;
    updateParticles();

    const coords = new Float32Array(particles.length * 4);
    for (let i = 0; i < particles.length; i++) {
      coords[i * 4] = particles[i].lon;
      coords[i * 4 + 1] = particles[i].lat;
      coords[i * 4 + 2] = particles[i].intensity;
      coords[i * 4 + 3] = particles[i].age / particles[i].life;
    }
    self.postMessage({ type: 'tick', coords }, [coords.buffer]);
  }
};

function initParticles() {
  particles = [];
  for (let i = 0; i < maxParticles; i++) {
    particles.push(createParticle());
  }
}

function createParticle() {
  if (!bounds) return { lat: 0, lon: 0, age: 0, life: 10, intensity: 0 };
  const lat = bounds.latMin + Math.random() * (bounds.latMax - bounds.latMin);
  const lon = bounds.lonMin + Math.random() * (bounds.lonMax - bounds.lonMin);
  const life = 30 + Math.random() * 50;
  return {
    lat,
    lon,
    // Staggered so a reseed after a pan or zoom does not fade the whole field in at once.
    age: Math.random() * life,
    life,
    intensity: 0
  };
}

function interpolateWind(lat, lon) {
  if (!grid || !grid.uGrid || grid.uGrid.length === 0) return [0, 0];

  const lats = grid.latGrid;
  const lons = grid.lonGrid;
  const rows = lats.length;
  const cols = lats[0].length;

  const lat1 = lats[0][0];
  const lat2 = lats[rows - 1][0];
  const dLat = (lat2 - lat1) / (rows - 1);

  const lon1 = lons[0][0];
  const lon2 = lons[0][cols - 1];
  const dLon = (lon2 - lon1) / (cols - 1);

  if (dLat === 0 || dLon === 0) return [0, 0];

  const r = (lat - lat1) / dLat;
  const c = (lon - lon1) / dLon;

  const r0 = Math.floor(r);
  const r1 = r0 + 1;
  const c0 = Math.floor(c);
  const c1 = c0 + 1;

  if (r0 < 0 || r1 >= rows || c0 < 0 || c1 >= cols) {
    return null;
  }

  const t = r - r0;
  const s = c - c0;

  const u00 = grid.uGrid[r0][c0];
  const u10 = grid.uGrid[r1][c0];
  const u01 = grid.uGrid[r0][c1];
  const u11 = grid.uGrid[r1][c1];

  const v00 = grid.vGrid[r0][c0];
  const v10 = grid.vGrid[r1][c0];
  const v01 = grid.vGrid[r0][c1];
  const v11 = grid.vGrid[r1][c1];

  const u = (1-t)*(1-s)*u00 + t*(1-s)*u10 + (1-t)*s*u01 + t*s*u11;
  const v = (1-t)*(1-s)*v00 + t*(1-s)*v10 + (1-t)*s*v01 + t*s*v11;

  return [u, v];
}

function updateParticles() {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.age++;

    if (p.age > p.life) {
      particles[i] = createParticle();
      continue;
    }

    const wind = interpolateWind(p.lat, p.lon);
    if (!wind) {
      particles[i] = createParticle();
      continue;
    }

    const [u, v] = wind;
    p.intensity = Math.sqrt(u*u + v*v);

    const cosLat = Math.cos(p.lat * Math.PI / 180.0);
    p.lat += v * speedScale;
    p.lon += u * speedScale / (cosLat || 1);

    if (p.lat < bounds.latMin || p.lat > bounds.latMax || p.lon < bounds.lonMin || p.lon > bounds.lonMax) {
      particles[i] = createParticle();
    }
  }
}
`;

/**
 * A running particle worker, plus the Blob URL it was built from.
 *
 * The URL has to be revoked when the worker is torn down or every field change
 * leaks one for the life of the page — on a chart left running for a passage
 * that is thousands.
 */
export interface WindWorkerHandle {
  worker: Worker;
  dispose(): void;
}

/** Builds the particle worker. Returns null where Workers or Blob URLs are unavailable. */
export function createWindWorker(): WindWorkerHandle | null {
  try {
    const url = URL.createObjectURL(
      new Blob([WIND_WORKER_SOURCE], { type: 'text/javascript' })
    );
    const worker = new Worker(url);
    return {
      worker,
      dispose() {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    };
  } catch (err) {
    console.error('[Wind] Could not start the wind particle worker:', err);
    return null;
  }
}
