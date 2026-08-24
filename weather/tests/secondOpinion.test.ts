import { describe, it, expect } from 'vitest';
import { compareSecondOpinion, type DepartureOutcome } from '../src/secondOpinion.js';
import { fetchWindField } from '../src/windField.js';

const out = (key: number, etaHours: number, reached = true): DepartureOutcome => ({ key, etaHours, reached });

describe('compareSecondOpinion', () => {
  // Departure keys are hours after the earliest departure, so arrival time is
  // key + etaHours: leaving 6 h later and sailing 20 h arrives at 26 h.
  const primary = [out(0, 30), out(6, 22), out(12, 24)];

  it('agrees when the pick matches and the timing is close', () => {
    const o = compareSecondOpinion(primary, [out(0, 31), out(6, 23), out(12, 25)], 'ecmwf_ifs025', 'ECMWF');
    expect(o?.agrees).toBe(true);
    expect(o?.primaryBest).toBe(6);
    expect(o?.secondBest).toBe(6);
    expect(o?.summary).toMatch(/ECMWF agrees/);
  });

  it('flags a material timing gap even when the pick matches', () => {
    const o = compareSecondOpinion(primary, [out(0, 40), out(6, 30), out(12, 44)], 'ecmwf_ifs025', 'ECMWF');
    expect(o?.agrees).toBe(false);
    expect(o?.secondBest).toBe(6);
    expect(o?.etaDeltaHours).toBe(8);
    expect(o?.summary).toMatch(/8h later/);
    expect(o?.summary).toMatch(/less settled/);
  });

  it('flags a different recommended departure', () => {
    // Second model: leaving at 0 arrives at 20; leaving at 6 arrives at 34.
    const o = compareSecondOpinion(primary, [out(0, 20), out(6, 28), out(12, 30)], 'ecmwf_ifs025', 'ECMWF');
    expect(o?.agrees).toBe(false);
    expect(o?.primaryBest).toBe(6);
    expect(o?.secondBest).toBe(0);
    expect(o?.summary).toMatch(/different departure/);
  });

  it('says so plainly when the second model cannot make the passage at all', () => {
    const o = compareSecondOpinion(primary, [out(0, 40), out(6, 0, false), out(12, 41)], 'ecmwf_ifs025', 'ECMWF');
    expect(o?.agrees).toBe(false);
    expect(o?.etaDeltaHours).toBeNull();
    expect(o?.summary).toMatch(/does not get this passage in/);
  });

  it('ranks on arrival time, not passage length', () => {
    // Leaving at 0 sails 25 h and arrives at 25; leaving at 12 sails 20 h — a
    // shorter passage — but arrives at 32. Earliest arrival is the 0 departure.
    const o = compareSecondOpinion([out(0, 25), out(12, 20)], [out(0, 25), out(12, 20)], 'm', 'M');
    expect(o?.primaryBest).toBe(0);
  });

  it('returns nothing when the primary never arrives', () => {
    expect(compareSecondOpinion([out(0, 0, false)], [out(0, 20)], 'm')).toBeNull();
  });

  it('returns nothing without a second set to compare', () => {
    expect(compareSecondOpinion(primary, [], 'm')).toBeNull();
  });

  it('reports sub-hour agreement in minutes', () => {
    const o = compareSecondOpinion(primary, [out(0, 30), out(6, 22.4), out(12, 24)], 'm', 'ECMWF');
    expect(o?.summary).toMatch(/24 min/);
  });
});

describe('fetchWindField model selection', () => {
  const hourly = (n: number) => ({
    time: Array.from({ length: n }, (_, i) => `2026-08-24T${String(i).padStart(2, '0')}:00`),
    wind_speed_10m: Array.from({ length: n }, () => 12),
    wind_direction_10m: Array.from({ length: n }, () => 270)
  });

  it('asks for best_match by default and records it on the field', async () => {
    let asked = '';
    const field = await fetchWindField(
      { north: 1, south: 0, east: 1, west: 0 },
      {
        days: 1,
        fetchImpl: (async (url: any) => {
          asked = String(url);
          return { ok: true, json: async () => Array.from({ length: 4 }, () => ({ hourly: hourly(24) })) };
        }) as any
      }
    );
    expect(asked).toContain('models=best_match');
    expect(field.model).toBe('best_match');
  });

  it('asks for the model it was given, one model per request', async () => {
    let asked = '';
    const field = await fetchWindField(
      { north: 1, south: 0, east: 1, west: 0 },
      {
        days: 1,
        model: 'ecmwf_ifs025',
        fetchImpl: (async (url: any) => {
          asked = String(url);
          return { ok: true, json: async () => Array.from({ length: 4 }, () => ({ hourly: hourly(24) })) };
        }) as any
      }
    );
    expect(asked).toContain('models=ecmwf_ifs025');
    // One model per request keeps the response shape the plain, verified one.
    expect(asked.match(/models=/g)).toHaveLength(1);
    expect(asked.match(/models=([^&]*)/)?.[1]).not.toContain(',');
    expect(field.model).toBe('ecmwf_ifs025');
  });
});
