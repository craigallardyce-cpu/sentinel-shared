import { describe, expect, it } from 'vitest';
import { WIND_WORKER_SOURCE } from '../src/windParticleWorker';

/**
 * The worker ships as source text, so it is run here the way a Worker would
 * run it: evaluated against a `self` it can post to.
 */
function startWorker() {
  const ticks: Float32Array[] = [];
  const self: any = { postMessage: (message: any) => ticks.push(message.coords) };
  // eslint-disable-next-line no-new-func
  new Function('self', WIND_WORKER_SOURCE)(self);
  const send = (type: string, data?: unknown) => self.onmessage({ data: { type, data } });
  return { ticks, send };
}

/** A 4x4 grid, one degree apart, blowing 10 kt eastward, with optional holes. */
function grid(holes: Array<[number, number]> = []) {
  const lats = [40, 41, 42, 43];
  const lons = [-72, -71, -70, -69];
  const uGrid = lats.map(() => lons.map(() => 10));
  const vGrid = lats.map(() => lons.map(() => 0));
  for (const [r, c] of holes) {
    uGrid[r][c] = NaN;
    vGrid[r][c] = NaN;
  }
  return {
    grid: {
      latGrid: lats.map((la) => lons.map(() => la)),
      lonGrid: lats.map(() => lons.slice()),
      uGrid,
      vGrid
    },
    bounds: { latMin: 40, latMax: 43, lonMin: -72, lonMax: -69 },
    maxParticles: 200,
    speedScale: 0.01
  };
}

describe('the wind particle worker', () => {
  it('answers every update with a frame of real positions', () => {
    const { ticks, send } = startWorker();
    send('init', grid());
    for (let i = 0; i < 50; i++) send('update');
    expect(ticks.length).toBe(50);
    expect(Array.from(ticks[49]).every(Number.isFinite)).toBe(true);
  });

  it('keeps animating over a hole in the forecast', () => {
    /*
      One corner of one cell with no wind. A particle that reached it was moved
      by NaN, and on the next frame its position indexed the grid with NaN and
      threw. The frame was never sent, the layer waited for it for ever, and the
      wind stood still on the chart.
    */
    const { ticks, send } = startWorker();
    send('init', grid([[1, 1], [2, 2]]));
    expect(() => {
      for (let i = 0; i < 300; i++) send('update');
    }).not.toThrow();
    expect(ticks.length).toBe(300);
    for (const coords of [ticks[0], ticks[150], ticks[299]]) {
      expect(Array.from(coords).every(Number.isFinite)).toBe(true);
    }
  });

  it('survives a grid that is all holes', () => {
    const { ticks, send } = startWorker();
    const everywhere: Array<[number, number]> = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) everywhere.push([r, c]);
    send('init', grid(everywhere));
    for (let i = 0; i < 20; i++) send('update');
    expect(ticks.length).toBe(20);
    expect(Array.from(ticks[19]).every(Number.isFinite)).toBe(true);
  });

  it('survives a grid too small to interpolate', () => {
    const { ticks, send } = startWorker();
    send('init', {
      grid: { latGrid: [[40]], lonGrid: [[-70]], uGrid: [[10]], vGrid: [[0]] },
      bounds: { latMin: 40, latMax: 40, lonMin: -70, lonMax: -70 },
      maxParticles: 10,
      speedScale: 0.01
    });
    for (let i = 0; i < 5; i++) send('update');
    expect(ticks.length).toBe(5);
    expect(Array.from(ticks[4]).every(Number.isFinite)).toBe(true);
  });
});
