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

  it('reads every wind a period names, not only the first', () => {
    // The afternoon is the part that matters, and it used to be dropped.
    expect(parseNwsWind('NW winds 10 to 15 kt, increasing to 20 to 25 kt in the afternoon. Seas 3 to 5 ft.'))
      .toEqual({ sustainedMin: 10, sustainedMax: 25, gust: null, max: 25 });
    expect(parseNwsWind('N winds 5 to 10 kt, becoming NW 15 to 20 kt after midnight.'))
      .toEqual({ sustainedMin: 5, sustainedMax: 20, gust: null, max: 20 });
    expect(parseNwsWind('SW winds 15 to 20 kt, diminishing to 5 to 10 kt.'))
      .toEqual({ sustainedMin: 5, sustainedMax: 20, gust: null, max: 20 });
  });

  it('takes the highest gust, and keeps gusts out of the sustained range', () => {
    const w = parseNwsWind(
      'N winds 15 to 20 kt with gusts up to 30 kt, becoming NW 20 to 25 kt with gusts up to 35 kt after midnight.'
    );
    expect(w).toEqual({ sustainedMin: 15, sustainedMax: 25, gust: 35, max: 35 });
    expect(parseNwsWind('Winds could gust as high as 30 mph.')).toEqual({
      sustainedMin: null, sustainedMax: null, gust: 26, max: 26,
    });
    expect(parseNwsWind('S winds 10 kt. Gusts up to 25 kt in the evening. Winds becoming W 5 kt.'))
      .toEqual({ sustainedMin: 5, sustainedMax: 10, gust: 25, max: 25 });
  });

  it('reads speeds NWS writes without the word "wind" in front of them', () => {
    expect(parseNwsWind('Variable winds less than 10 kt.').max).toBe(10);
    expect(parseNwsWind('NW 15 kt.').max).toBe(15);
  });

  it('does not take seas, visibility or percentages for wind', () => {
    const w = parseNwsWind('Seas 8 to 10 ft. Vsby 1 to 3 nm. Chance of precipitation is 40%. High near 59.');
    expect(w).toEqual({ sustainedMin: null, sustainedMax: null, gust: null, max: 0 });
  });

  it('takes the windSpeed field with the text, whichever is higher', () => {
    // The field covers the whole period; the text here names only its start.
    const w = parseNwsWind('Northwest wind around 10 mph.', '10 to 25 mph');
    expect(w).toEqual({ sustainedMin: 9, sustainedMax: 22, gust: null, max: 22 });
  });

  it('survives a period with no text at all', () => {
    expect(parseNwsWind(undefined as unknown as string, '5 mph').max).toBe(4);
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
