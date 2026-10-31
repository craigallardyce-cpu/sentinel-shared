import { describe, expect, it } from 'vitest';
import {
  nwsPeriodTimes, nwsPeriodIsCurrent, parseNwsTime,
  parseNwsWind, parseNwsWindSpeed, windUnit, toKnots,
} from '../src/index';

// Moved with the helpers from HarborSentinel's tests/nwsZoneForecast.test.ts,
// which keeps the tests of its own forecast pipeline.
const ZONE_PERIOD = { number: 1, name: 'Tonight', detailedForecast: 'NW winds 10 to 15 kt.' };

describe('nwsPeriodTimes', () => {
  it('is null for both times of a marine zone period, which carries none', () => {
    expect(nwsPeriodTimes(ZONE_PERIOD)).toEqual({ startTime: null, endTime: null });
  });

  it("passes a gridpoint period's times through as NWS wrote them", () => {
    const p = { startTime: '2026-10-05T18:00:00-04:00', endTime: '2026-10-06T06:00:00-04:00' };
    expect(nwsPeriodTimes(p)).toEqual(p);
  });

  it('takes a missing end as twelve hours after a known start', () => {
    expect(nwsPeriodTimes({ startTime: '2026-10-05T22:00:00Z' }).endTime).toBe('2026-10-06T10:00:00.000Z');
  });

  it('blanks a malformed time without throwing, and keeps the other one', () => {
    expect(nwsPeriodTimes({ startTime: 'Tonight', endTime: '2026-10-06T06:00:00-04:00' }))
      .toEqual({ startTime: null, endTime: '2026-10-06T06:00:00-04:00' });
    expect(nwsPeriodTimes({ startTime: 'not a time' })).toEqual({ startTime: null, endTime: null });
    expect(nwsPeriodTimes({ startTime: 1791248037810 })).toEqual({ startTime: null, endTime: null });
    expect(nwsPeriodTimes(undefined)).toEqual({ startTime: null, endTime: null });
    expect(nwsPeriodTimes(null)).toEqual({ startTime: null, endTime: null });
  });

  it('keeps a period whose end is unknown, and drops one that has ended', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    expect(nwsPeriodIsCurrent({ endTime: null }, now)).toBe(true);
    expect(nwsPeriodIsCurrent({ endTime: '2026-10-05T23:00:00Z' }, now)).toBe(false);
    expect(nwsPeriodIsCurrent({ endTime: '2026-10-06T01:00:00Z' }, now)).toBe(true);
    expect(nwsPeriodIsCurrent(undefined, now)).toBe(true);
  });
});

describe('parseNwsTime', () => {
  it('is a Date for an ISO string, and null for anything else', () => {
    expect(parseNwsTime('2026-10-05T18:00:00-04:00')?.toISOString()).toBe('2026-10-05T22:00:00.000Z');
    for (const v of ['', 'Tonight', undefined, null, 0, {}]) expect(parseNwsTime(v)).toBeNull();
  });
});

describe('wind speeds are knots whatever unit NWS wrote them in', () => {
  it('converts a gust given in mph: "as high as 36 mph" is 31 kt', () => {
    const w = parseNwsWind('Northwest wind 17 to 21 mph, with gusts as high as 36 mph.');
    expect(w).toEqual({ sustainedMin: 15, sustainedMax: 18, gust: 31, max: 31 });
  });

  it("leaves a zone forecast's knots alone: \"gusts up to 20 kt\" is 20 kt", () => {
    const w = parseNwsWind('NW winds 10 to 15 kt with gusts up to 20 kt. Waves 2 to 3 ft.');
    expect(w).toEqual({ sustainedMin: 10, sustainedMax: 15, gust: 20, max: 20 });
  });

  it('reads a gridpoint windSpeed field as mph: "10 to 15 mph" is 9 to 13 kt', () => {
    expect(parseNwsWindSpeed('10 to 15 mph')).toEqual({ min: 9, max: 13 });
    expect(parseNwsWindSpeed('5 mph')).toEqual({ min: 4, max: 4 });
    expect(parseNwsWindSpeed('10 kt')).toEqual({ min: 10, max: 10 });
    expect(parseNwsWindSpeed(undefined)).toBeNull();
  });

  it('falls back to the windSpeed field when the text names no wind', () => {
    expect(parseNwsWind('Sunny, with a high near 59.', '10 to 15 mph').max).toBe(13);
    expect(parseNwsWind('', undefined).max).toBe(0);
  });

  it('spells units every way NWS does', () => {
    expect(['kt', 'kts', 'KNOTS', 'knot'].map(windUnit)).toEqual(['kt', 'kt', 'kt', 'kt']);
    expect(['mph', 'm.p.h.', 'MPH'].map(windUnit)).toEqual(['mph', 'mph', 'mph']);
    expect(windUnit('furlongs')).toBeNull();
    expect(windUnit(undefined)).toBeNull();
    expect(toKnots(36, 'mph')).toBe(31);
    expect(toKnots(20.4, 'kt')).toBe(20);
  });
});
