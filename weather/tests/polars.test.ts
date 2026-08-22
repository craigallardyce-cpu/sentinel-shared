import { describe, it, expect } from 'vitest';
import {
  boatSpeed,
  foldTwa,
  bestVmg,
  parsePolarFile,
  GENERIC_POLARS,
  type PolarDiagram
} from '../src/polars.js';

const polar = GENERIC_POLARS.cruisingMonohull;

describe('foldTwa', () => {
  it.each([
    [0, 0], [90, 90], [180, 180], [190, 170], [270, 90], [350, 10], [-30, 30], [360, 0]
  ])('folds %i° to %i°', (input, expected) => {
    expect(foldTwa(input)).toBe(expected);
  });
});

describe('boatSpeed', () => {
  it('reads a value straight off the table', () => {
    // 90° TWA at 10 kt is the 7th row, 3rd column of the generic cruiser.
    expect(boatSpeed(polar, 90, 10)).toBeCloseTo(6.8, 5);
  });

  it('interpolates between wind speeds', () => {
    const at10 = boatSpeed(polar, 90, 10);
    const at12 = boatSpeed(polar, 90, 12);
    expect(boatSpeed(polar, 90, 11)).toBeCloseTo((at10 + at12) / 2, 5);
  });

  it('interpolates between wind angles', () => {
    const at75 = boatSpeed(polar, 75, 10);
    const at90 = boatSpeed(polar, 90, 10);
    const mid = boatSpeed(polar, 82.5, 10);
    expect(mid).toBeGreaterThan(Math.min(at75, at90) - 1e-9);
    expect(mid).toBeLessThan(Math.max(at75, at90) + 1e-9);
  });

  it('is symmetric about the wind axis', () => {
    expect(boatSpeed(polar, 250, 12)).toBeCloseTo(boatSpeed(polar, 110, 12), 10);
  });

  it('will not sail inside the pointing angle', () => {
    expect(boatSpeed(polar, 0, 15)).toBe(0);
    expect(boatSpeed(polar, 20, 15)).toBe(0);
  });

  it('clamps above the top of the table rather than extrapolating into a reef', () => {
    const top = boatSpeed(polar, 110, 25);
    expect(boatSpeed(polar, 110, 60)).toBe(top);
  });

  it('returns nothing in no wind', () => {
    expect(boatSpeed(polar, 90, 0)).toBe(0);
    expect(boatSpeed(polar, 90, NaN)).toBe(0);
  });
});

describe('bestVmg', () => {
  it('finds a close-hauled angle upwind', () => {
    const vmg = bestVmg(polar, 12, 'upwind');
    expect(vmg.twaDeg).toBeGreaterThanOrEqual(40);
    expect(vmg.twaDeg).toBeLessThan(60);
    expect(vmg.vmgKts).toBeGreaterThan(0);
  });

  it('finds a broad angle downwind, not dead run', () => {
    const vmg = bestVmg(polar, 12, 'downwind');
    expect(vmg.twaDeg).toBeGreaterThan(120);
    expect(vmg.vmgKts).toBeGreaterThan(0);
  });

  it('reports no angle when there is no wind', () => {
    expect(bestVmg(polar, 0, 'upwind').twaDeg).toBeNull();
  });
});

describe('parsePolarFile', () => {
  const sample = [
    'twa/tws\t6\t10\t14',
    '40\t3.8\t5.2\t5.7',
    '90\t5.3\t6.8\t7.5',
    '150\t3.9\t5.4\t6.3'
  ].join('\n');

  it('reads the standard tab-separated table', () => {
    const p = parsePolarFile(sample, 'Test boat');
    expect(p.name).toBe('Test boat');
    expect(p.twsValues).toEqual([6, 10, 14]);
    expect(p.twaValues).toEqual([40, 90, 150]);
    expect(boatSpeed(p, 90, 10)).toBeCloseTo(6.8, 5);
  });

  it.each([
    ['semicolons', sample.replace(/\t/g, ';')],
    ['commas', sample.replace(/\t/g, ',')],
    ['spaces', sample.replace(/\t/g, '  ')]
  ])('accepts %s, because exports in the wild use all four', (_label, text) => {
    expect(parsePolarFile(text).twsValues).toEqual([6, 10, 14]);
  });

  it('sorts rows given in descending order', () => {
    const reversed = ['twa/tws\t6\t10', '150\t3.9\t5.4', '40\t3.8\t5.2'].join('\n');
    expect(parsePolarFile(reversed).twaValues).toEqual([40, 150]);
  });

  it('ignores comments and blank lines', () => {
    const messy = `# my boat\n\n${sample}\n\n`;
    expect(parsePolarFile(messy).twaValues).toEqual([40, 90, 150]);
  });

  it.each([
    ['a file with no rows', 'twa/tws\t6\t10'],
    ['an empty file', ''],
    ['a non-numeric speed', 'twa/tws\t6\n40\tfast']
  ])('rejects %s with a readable message', (_label, text) => {
    expect(() => parsePolarFile(text)).toThrow();
  });
});

describe('generic polars', () => {
  it.each(Object.entries(GENERIC_POLARS))('%s is well formed and labelled generic', (_key, p: PolarDiagram) => {
    expect(p.generic).toBe(true);
    expect(p.speeds).toHaveLength(p.twaValues.length);
    for (const row of p.speeds) expect(row).toHaveLength(p.twsValues.length);
    // Axes must ascend or interpolation silently misreads the table.
    for (let i = 1; i < p.twaValues.length; i++) expect(p.twaValues[i]).toBeGreaterThan(p.twaValues[i - 1]);
    for (let i = 1; i < p.twsValues.length; i++) expect(p.twsValues[i]).toBeGreaterThan(p.twsValues[i - 1]);
  });

  it('has a catamaran that will not point like a raceboat', () => {
    expect(boatSpeed(GENERIC_POLARS.cruisingCatamaran, 40, 14)).toBe(0);
    expect(boatSpeed(GENERIC_POLARS.performanceMonohull, 40, 14)).toBeGreaterThan(0);
  });

  it('has a performance boat faster than a cruiser at the same angle', () => {
    expect(boatSpeed(GENERIC_POLARS.performanceMonohull, 110, 14))
      .toBeGreaterThan(boatSpeed(GENERIC_POLARS.cruisingMonohull, 110, 14));
  });
});
