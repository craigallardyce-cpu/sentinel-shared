import { describe, it, expect } from 'vitest';
import {
  createPolarAccumulator,
  addSample,
  derivePolar,
  mergeAccumulators,
  trueWindAngle,
  toPolFile,
  serializeAccumulator,
  deserializeAccumulator
} from '../src/polarLearning.js';
import { boatSpeed, parsePolarFile, GENERIC_POLARS } from '../src/polars.js';
import { routeIsochrone } from '../src/routing.js';

const T0 = Date.UTC(2026, 7, 22, 0, 0, 0);

/** A steady sample stream: same conditions, ten seconds apart. */
function feed(acc: any, n: number, sample: any, startT = T0, stepMs = 10_000) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(addSample(acc, { t: startT + i * stepMs, ...sample }));
  }
  return results;
}

describe('trueWindAngle', () => {
  it.each([
    ['head to wind', 0, 0, 0],
    ['beam reach starboard', 90, 0, 90],
    ['dead run', 180, 0, 180],
    ['close hauled port', 315, 0, 45],
    ['folds across north', 10, 350, 20]
  ])('%s', (_label, heading, twd, expected) => {
    expect(trueWindAngle(twd, heading)).toBeCloseTo(expected, 6);
  });
});

describe('addSample', () => {
  it('accepts steady sailing and files it on the nearest grid node', () => {
    const acc = createPolarAccumulator();
    // Heading 090, wind from 000 => TWA 90. TWS 13.6 rounds to the 14 node.
    const r = addSample(acc, { t: T0, stw: 7.4, tws: 13.6, twd: 0, heading: 90 });
    expect(r.accepted).toBe(true);
    expect(r.twaDeg).toBeCloseTo(90, 6);
    expect(acc.accepted).toBe(1);
    // twaValues index of 90 is 6; twsValues index of 14 is 4.
    expect(acc.bins['6:4']?.count).toBe(1);
  });

  it.each([
    ['motoring', { stw: 6, tws: 10, twd: 0, heading: 90, engineRpm: 1800 }, 'motoring'],
    ['becalmed', { stw: 0.5, tws: 1, twd: 0, heading: 90 }, 'becalmed'],
    ['not moving', { stw: 0.05, tws: 12, twd: 0, heading: 90 }, 'not-moving'],
    ['implausible speed', { stw: 99, tws: 12, twd: 0, heading: 90 }, 'implausible'],
    ['missing data', { stw: NaN, tws: 12, twd: 0, heading: 90 }, 'incomplete']
  ])('refuses %s and says why', (_label, sample, reason) => {
    const acc = createPolarAccumulator();
    const r = addSample(acc, { t: T0, ...(sample as any) });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe(reason);
    expect(acc.accepted).toBe(0);
  });

  it('refuses a boat mid-manoeuvre', () => {
    const acc = createPolarAccumulator();
    addSample(acc, { t: T0, stw: 7, tws: 14, twd: 0, heading: 90 });
    const turning = addSample(acc, { t: T0 + 10_000, stw: 7, tws: 14, twd: 0, heading: 130 });
    expect(turning.accepted).toBe(false);
    expect(turning.reason).toBe('manoeuvring');
  });

  it('refuses a sample where the wind has not settled', () => {
    const acc = createPolarAccumulator();
    addSample(acc, { t: T0, stw: 7, tws: 12, twd: 0, heading: 90 });
    const gust = addSample(acc, { t: T0 + 10_000, stw: 7, tws: 25, twd: 0, heading: 90 });
    expect(gust.accepted).toBe(false);
    expect(gust.reason).toBe('wind-unsettled');
  });

  it('does not judge steadiness across a long gap', () => {
    const acc = createPolarAccumulator();
    addSample(acc, { t: T0, stw: 7, tws: 12, twd: 0, heading: 90 });
    // Two hours later the boat is elsewhere on another point of sail; that is
    // not a manoeuvre, it is a new steady state.
    const later = addSample(acc, { t: T0 + 7_200_000, stw: 7, tws: 20, twd: 0, heading: 180 });
    expect(later.accepted).toBe(true);
  });

  it('lets a boat with a high idle be tuned rather than rejecting everything', () => {
    const acc = createPolarAccumulator();
    const strict = addSample(acc, { t: T0, stw: 6, tws: 12, twd: 0, heading: 90, engineRpm: 600 });
    expect(strict.reason).toBe('motoring');
    const tuned = addSample(acc, { t: T0 + 10_000, stw: 6, tws: 12, twd: 0, heading: 90, engineRpm: 600 },
      { motoringRpm: 900 });
    expect(tuned.accepted).toBe(true);
  });

  it('counts what it refused, so a boat can find out why nothing is filling in', () => {
    const acc = createPolarAccumulator();
    feed(acc, 5, { stw: 6, tws: 12, twd: 0, heading: 90, engineRpm: 1500 });
    expect(acc.accepted).toBe(0);
    expect(acc.rejected).toBe(5);
  });
});

describe('derivePolar', () => {
  it('reads a high percentile, not an average of every scrappy hour', () => {
    const acc = createPolarAccumulator();
    // An afternoon in the same conditions, sailed with varying attention:
    // speeds spread from 5.5 to 7.5, centred near 6.5.
    const speeds = [5.5, 5.75, 6.0, 6.0, 6.25, 6.25, 6.5, 6.5, 6.5, 6.75, 6.75, 7.0, 7.25, 7.5];
    let t = T0;
    for (let pass = 0; pass < 10; pass++) {
      for (const stw of speeds) {
        addSample(acc, { t, stw, tws: 14, twd: 0, heading: 90 });
        t += 10_000;
      }
    }

    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length; // ~6.45
    const derived = boatSpeed(derivePolar(acc).polar, 90, 14);
    // The polar should describe the boat sailed well, not the average hour.
    expect(derived).toBeGreaterThan(mean + 0.4);
    // But it is a percentile, not the single best surf ever recorded.
    expect(derived).toBeLessThanOrEqual(7.5);
  });

  it('falls back where the boat has not sailed enough', () => {
    const acc = createPolarAccumulator();
    feed(acc, 60, { stw: 9.75, tws: 14, twd: 0, heading: 90 });
    const fallback = GENERIC_POLARS.cruisingMonohull;
    const { polar, coverage } = derivePolar(acc, { fallback });

    // The measured node reports what was measured...
    expect(boatSpeed(polar, 90, 14)).toBeCloseTo(9.75, 2);
    // ...and an unsailed one still reports the generic curve, unchanged.
    expect(boatSpeed(polar, 135, 20)).toBeCloseTo(boatSpeed(fallback, 135, 20), 6);
    expect(coverage.measuredNodes).toBe(1);
    expect(coverage.measuredFraction).toBeGreaterThan(0);
    expect(coverage.measuredFraction).toBeLessThan(0.1);
  });

  it('will not trust a node with only a handful of samples', () => {
    const acc = createPolarAccumulator();
    feed(acc, 5, { stw: 12, tws: 14, twd: 0, heading: 90 });
    const { polar, coverage } = derivePolar(acc);
    expect(coverage.measuredNodes).toBe(0);
    // The improbable 12 kt does not reach the polar.
    expect(boatSpeed(polar, 90, 14)).toBeLessThan(9);
  });

  it('carries its own caveat, so every route planned with it says so', () => {
    const acc = createPolarAccumulator();
    feed(acc, 60, { stw: 7, tws: 14, twd: 0, heading: 90 });
    const { polar } = derivePolar(acc);
    expect(polar.generic).toBe(false);
    expect(polar.note).toMatch(/comes from your own sailing/);

    const result = routeIsochrone({
      start: { lat: 40, lon: -70 },
      destination: { lat: 40, lon: -69 },
      departure: T0,
      polar,
      wind: () => ({ speedKts: 14, directionDeg: 0 })
    });
    expect(result.warnings.some((w) => /comes from your own sailing/.test(w))).toBe(true);
    // And it is not scolded for being generic, because it is not.
    expect(result.warnings.some((w) => /generic polar \(/.test(w))).toBe(false);
  });

  it('does not count unsailable angles against coverage', () => {
    const acc = createPolarAccumulator();
    const { coverage } = derivePolar(acc);
    // 13 angles x 8 strengths is 104 nodes, but the ones inside the pointing
    // angle can never be filled, so they are excluded from the denominator.
    expect(coverage.sailableNodes).toBeLessThan(104);
    expect(coverage.sailableNodes).toBeGreaterThan(60);
  });

  it('reports coverage cells for a "where have I sailed" view', () => {
    const acc = createPolarAccumulator();
    feed(acc, 40, { stw: 7, tws: 14, twd: 0, heading: 90 });
    const { coverage } = derivePolar(acc);
    const cell = coverage.cells.find((c) => c.twaDeg === 90 && c.twsKts === 14);
    expect(cell).toMatchObject({ count: 40, measured: true });
    expect(coverage.cells.filter((c) => c.measured)).toHaveLength(1);
  });
});

describe('mergeAccumulators', () => {
  it('adds two devices\' seasons together', () => {
    const helm = createPolarAccumulator();
    const nav = createPolarAccumulator();
    feed(helm, 20, { stw: 7, tws: 14, twd: 0, heading: 90 });
    feed(nav, 20, { stw: 7, tws: 14, twd: 0, heading: 90 }, T0 + 3_600_000);

    // Neither alone reaches the threshold; together they do.
    expect(derivePolar(helm).coverage.measuredNodes).toBe(0);
    const merged = mergeAccumulators(helm, nav);
    expect(merged.bins['6:4'].count).toBe(40);
    expect(derivePolar(merged).coverage.measuredNodes).toBe(1);
    expect(merged.firstSampleAt).toBe(T0);
  });

  it('refuses to merge accumulators built on different grids', () => {
    expect(() => mergeAccumulators(createPolarAccumulator(), createPolarAccumulator([0, 90, 180])))
      .toThrow(/share a grid/);
  });
});

describe('storage and export', () => {
  it('round-trips through storage', () => {
    const acc = createPolarAccumulator();
    feed(acc, 40, { stw: 7.2, tws: 14, twd: 0, heading: 90 });
    const restored = deserializeAccumulator(serializeAccumulator(acc));
    expect(restored.accepted).toBe(40);
    expect(derivePolar(restored).coverage.measuredNodes).toBe(1);
  });

  it('refuses a file it does not understand', () => {
    expect(() => deserializeAccumulator('{"version":99}')).toThrow(/this version can read/);
  });

  it('exports a .pol the fleet can read back', () => {
    const acc = createPolarAccumulator();
    feed(acc, 40, { stw: 7.25, tws: 14, twd: 0, heading: 90 });
    const { polar } = derivePolar(acc);
    const reparsed = parsePolarFile(toPolFile(polar), 'Round trip');
    expect(reparsed.twsValues).toEqual(polar.twsValues);
    expect(boatSpeed(reparsed, 90, 14)).toBeCloseTo(boatSpeed(polar, 90, 14), 2);
  });
});

describe('a season of sailing', () => {
  it('learns a boat that is faster than the generic curve', () => {
    const acc = createPolarAccumulator();
    const fallback = GENERIC_POLARS.cruisingMonohull;
    // Sail every angle and strength, consistently 15% quicker than generic.
    let t = T0;
    for (const twa of [50, 60, 75, 90, 110, 135, 150]) {
      for (const tws of [8, 10, 12, 14, 16, 20]) {
        const truth = boatSpeed(fallback, twa, tws) * 1.15;
        for (let i = 0; i < 40; i++) {
          addSample(acc, { t, stw: truth, tws, twd: 0, heading: twa });
          t += 10_000;
        }
        t += 7_200_000; // a gap, so the next block is not read as a manoeuvre
      }
    }

    const { polar, coverage } = derivePolar(acc);
    expect(coverage.measuredNodes).toBe(42);
    // 42 of the 88 nodes a cruising monohull can sail.
    expect(coverage.measuredFraction).toBeCloseTo(42 / 88, 2);
    for (const [twa, tws] of [[60, 10], [90, 14], [135, 20]] as const) {
      expect(boatSpeed(polar, twa, tws)).toBeGreaterThan(boatSpeed(fallback, twa, tws) * 1.1);
    }
  });
});
