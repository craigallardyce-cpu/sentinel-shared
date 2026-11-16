import { describe, expect, it } from 'vitest';
import { labelFrames, RADAR_LIVE_MAX_AGE_MIN } from '../src/useRadarFrames';

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const at = (minutesAgo: number) => ({ time: (NOW - minutesAgo * 60_000) / 1000, path: `/v2/radar/${minutesAgo}` });

describe('labelFrames', () => {
  it('calls the newest frame Live while it is recent, and the rest by their age', () => {
    const frames = labelFrames([at(25), at(15), at(5)], NOW);
    expect(frames.map((f) => f.relativeLabel)).toEqual(['-25m', '-15m', 'Live']);
    expect(frames[2].timeLabel).toMatch(/\(Live\)$/);
    expect(frames[2].path).toBe('/v2/radar/5');
  });

  it('stops calling it Live once it is not', () => {
    // The same frames four hours later, with no successful refresh in between.
    const later = NOW + 4 * 3600_000;
    const frames = labelFrames([at(25), at(15), at(5)], later);
    expect(frames[2].relativeLabel).toBe('-4h');
    expect(frames[2].timeLabel).toMatch(/\(-4h\)$/);
    expect(frames.some((f) => f.relativeLabel === 'Live')).toBe(false);
  });

  it('draws the line at twenty minutes', () => {
    expect(labelFrames([at(RADAR_LIVE_MAX_AGE_MIN)], NOW)[0].relativeLabel).toBe('Live');
    expect(labelFrames([at(RADAR_LIVE_MAX_AGE_MIN + 1)], NOW)[0].relativeLabel).toBe('-21m');
    expect(labelFrames([at(119)], NOW)[0].relativeLabel).toBe('-119m');
    expect(labelFrames([at(120)], NOW)[0].relativeLabel).toBe('-2h');
  });
});
