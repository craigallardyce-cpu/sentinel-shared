import { describe, expect, it } from 'vitest';
import { formatTempRangeString, NOT_GIVEN } from '../src/weatherUtils';

describe('formatTempRangeString', () => {
  it('converts a range between units', () => {
    expect(formatTempRangeString('18°C to 22°C', 'F')).toBe('64°F to 72°F');
    expect(formatTempRangeString('64°F to 72°F', 'C')).toBe('18°C to 22°C');
    expect(formatTempRangeString('18°C to 22°C', 'C')).toBe('18°C to 22°C');
  });

  it('keeps a minus sign with its number', () => {
    // -5°C is 23°F. It used to come out as "-41°F": the 5 converted, the sign left behind.
    expect(formatTempRangeString('-5°C to 3°C', 'F')).toBe('23°F to 37°F');
    expect(formatTempRangeString('-5°C to -1°C', 'F')).toBe('23°F to 30°F');
    expect(formatTempRangeString('14°F to 23°F', 'C')).toBe('-10°C to -5°C');
    expect(formatTempRangeString('-5°C to 3°C', 'C')).toBe('-5°C to 3°C');
    // The typographic minus some sources use.
    expect(formatTempRangeString('−5°C', 'F')).toBe('23°F');
  });

  it('reads a hyphen between two numbers as a separator, not a minus', () => {
    expect(formatTempRangeString('18-22°C', 'F')).toBe('64°F-72°F');
    expect(formatTempRangeString('18°C-22°C', 'F')).toBe('64°F-72°F');
  });

  it('gives a number with no unit the unit the text uses elsewhere', () => {
    expect(formatTempRangeString('18 to 22°C', 'F')).toBe('64°F to 72°F');
    // No unit anywhere is Fahrenheit, which is what NWS sends.
    expect(formatTempRangeString('59', 'C')).toBe('15°C');
  });

  it('never prints a negative zero', () => {
    expect(formatTempRangeString('31°F', 'C')).toBe('-1°C');
    expect(formatTempRangeString('32°F', 'C')).toBe('0°C');
    expect(formatTempRangeString('-0.4°C', 'C')).toBe('-0.4°C');
  });

  it('says so when the forecast gave none', () => {
    expect(formatTempRangeString(undefined, 'C')).toBe(NOT_GIVEN);
    expect(formatTempRangeString('', 'F')).toBe(NOT_GIVEN);
  });
});
