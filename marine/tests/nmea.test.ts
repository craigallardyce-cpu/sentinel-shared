import { describe, it, expect } from 'vitest';
import {
  validateNmeaChecksum,
  parseNmeaLatitude,
  parseNmeaLongitude,
  formatCoords,
  parseNmeaSentence,
  handleNmeaSentence,
  createNmeaLiveData
} from '../src/nmea.js';

/**
 * Computes a valid NMEA checksum independently of the module under test, so
 * fixtures can be built without hardcoding checksums from memory (which is
 * exactly the kind of hand-transcription error this suite should not depend on).
 */
function withChecksum(payloadWithoutDollarOrStar: string): string {
  let checksum = 0;
  for (const ch of payloadWithoutDollarOrStar) {
    checksum ^= ch.charCodeAt(0);
  }
  const hex = checksum.toString(16).toUpperCase().padStart(2, '0');
  return `$${payloadWithoutDollarOrStar}*${hex}`;
}

describe('validateNmeaChecksum', () => {
  it('accepts a correctly checksummed sentence', () => {
    const sentence = withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W');
    expect(validateNmeaChecksum(sentence)).toBe(true);
  });

  it('rejects a tampered payload with a stale checksum', () => {
    const good = withChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,');
    const tampered = good.replace('4807.038', '4900.000');
    expect(validateNmeaChecksum(tampered)).toBe(false);
  });

  it('rejects sentences without a leading $ or !', () => {
    expect(validateNmeaChecksum('GPRMC,foo*00')).toBe(false);
  });

  it('allows legacy sentences with no checksum field at all', () => {
    expect(validateNmeaChecksum('$GPRMC,123519,A')).toBe(true);
  });
});

describe('parseNmeaLatitude / parseNmeaLongitude', () => {
  it('parses a northern latitude', () => {
    expect(parseNmeaLatitude('4807.038', 'N')).toBeCloseTo(48 + 7.038 / 60, 6);
  });

  it('parses a southern latitude as negative', () => {
    expect(parseNmeaLatitude('4807.038', 'S')).toBeCloseTo(-(48 + 7.038 / 60), 6);
  });

  it('parses an eastern longitude', () => {
    expect(parseNmeaLongitude('01131.000', 'E')).toBeCloseTo(11 + 31 / 60, 6);
  });

  it('parses a western longitude as negative', () => {
    expect(parseNmeaLongitude('01131.000', 'W')).toBeCloseTo(-(11 + 31 / 60), 6);
  });

  it('rejects an invalid hemisphere letter', () => {
    expect(parseNmeaLatitude('4807.038', 'X')).toBeNull();
    expect(parseNmeaLongitude('01131.000', 'X')).toBeNull();
  });

  it('rejects malformed input with no decimal point', () => {
    expect(parseNmeaLatitude('4807', 'N')).toBeNull();
  });
});

describe('formatCoords', () => {
  it('formats a northeast coordinate', () => {
    const { latStr, lngStr } = formatCoords(41.225, -71.75);
    expect(latStr).toBe("N 41° 13.500'");
    expect(lngStr).toBe("W 071° 45.000'");
  });
});

describe('parseNmeaSentence', () => {
  it('parses a valid RMC sentence into position/speed/course', () => {
    const sentence = withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W');
    const result = parseNmeaSentence(sentence);
    expect(result).not.toBeNull();
    expect(result.latDec).toBeCloseTo(48 + 7.038 / 60, 6);
    expect(result.lonDec).toBeCloseTo(11 + 31 / 60, 6);
    expect(result.sog).toBeCloseTo(22.4, 6);
    expect(result.cog).toBeCloseTo(84.4, 6);
  });

  it('returns null for an RMC sentence with an invalid (void) status', () => {
    const sentence = withChecksum('GPRMC,123519,V,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W');
    expect(parseNmeaSentence(sentence)).toBeNull();
  });

  it('returns null when the checksum does not match', () => {
    const good = withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W');
    const corrupted = good.slice(0, -1) + (good.at(-1) === '0' ? '1' : '0');
    expect(parseNmeaSentence(corrupted)).toBeNull();
  });

  it('parses a valid GGA sentence with fix quality > 0', () => {
    const sentence = withChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,');
    const result = parseNmeaSentence(sentence);
    expect(result).not.toBeNull();
    expect(result.latDec).toBeCloseTo(48 + 7.038 / 60, 6);
  });

  it('returns null for a GGA sentence with no fix (quality 0)', () => {
    const sentence = withChecksum('GPGGA,123519,4807.038,N,01131.000,E,0,08,0.9,545.4,M,46.9,M,,');
    expect(parseNmeaSentence(sentence)).toBeNull();
  });

  it('parses depth from a DBT sentence as a below-transducer reading', () => {
    const sentence = withChecksum('SDDBT,032.4,f,009.9,M,005.4,F');
    const result = parseNmeaSentence(sentence);
    expect(result).not.toBeNull();
    // DBT is reported on its own datum rather than as depthFeet, so it cannot
    // silently contradict a DPT reading measured from the waterline.
    expect(result.depthBelowTransducerFeet).toBeCloseTo(32.4, 6);
    expect(result.depthFeet).toBeUndefined();

    // With no offset known it still reaches the consumer unchanged.
    const live = createNmeaLiveData();
    handleNmeaSentence(sentence, live);
    expect(live.depth).toBeCloseTo(32.4, 6);
  });

  it('holds one depth across a DBT/DPT pair', () => {
    // DBT measures from the transducer and DPT from the waterline, so a sounder
    // sending both used to make the reported depth square-wave between them by
    // the transducer's mounting depth — 1.6 ft on the boat this came from.
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIDPT,4.9,0.5'), live);
    const afterDpt = live.depth;
    handleNmeaSentence(withChecksum('IIDBT,16.1,f,4.9,M,2.7,F'), live);
    const afterDbt = live.depth;
    expect(afterDpt).toBeCloseTo((4.9 + 0.5) * 3.28084, 3);
    expect(afterDbt).toBeCloseTo(afterDpt, 1);
  });

  it('uses a bare DBT reading as-is until DPT gives the offset', () => {
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIDBT,16.1,f,4.9,M,2.7,F'), live);
    expect(live.depth).toBeCloseTo(16.1, 3);
    expect(live.depth_offset_ft).toBeNull();
  });

  it('does not apply the transducer offset to DBS', () => {
    // DBS already measures from the surface.
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIDPT,4.9,0.5'), live);
    handleNmeaSentence(withChecksum('SDDBS,17.7,f,5.4,M,2.9,F'), live);
    expect(live.depth).toBeCloseTo(17.7, 3);
  });

  it('parses true wind from an MWD sentence', () => {
    const sentence = withChecksum('WIMWD,,,270.0,M,12.5,N,6.4,M');
    const result = parseNmeaSentence(sentence);
    expect(result).not.toBeNull();
    expect(result.twd).toBeCloseTo(270.0, 6);
    expect(result.tws).toBeCloseTo(12.5, 6);
  });

  it('parses relative apparent wind from an MWV sentence', () => {
    const sentence = withChecksum('WIMWV,045.0,R,012.0,N,A');
    const result = parseNmeaSentence(sentence);
    expect(result).not.toBeNull();
    expect(result.awa).toBe('45° STBD');
    expect(result.aws).toBeCloseTo(12.0, 6);
  });

  it('prefers the true direction over the magnetic one in MWD', () => {
    const sentence = withChecksum('WIMWD,232.8,T,246.8,M,14.1,N,7.3,M');
    const result = parseNmeaSentence(sentence);
    expect(result.twd).toBeCloseTo(232.8, 6);
  });

  it('does not read an MWV wind angle as a wind direction', () => {
    // Both references are angles off the bow, not compass bearings.
    for (const ref of ['R', 'T']) {
      const result = parseNmeaSentence(withChecksum(`WIMWV,021.3,${ref},014.1,N,A`));
      expect(result).not.toBeNull();
      expect(result.twd).toBeUndefined();
      expect(result.awd).toBeUndefined();
    }
  });

  it('does not read a VWR wind angle as a wind direction', () => {
    const result = parseNmeaSentence(withChecksum('IIVWR,024.5,R,014.7,N,,,,'));
    expect(result).not.toBeNull();
    expect(result.awd).toBeUndefined();
  });

  it('holds one wind direction across a full MWV/MWV/MWD cycle', () => {
    // The regression in full: one second of a real feed, head to wind. Every
    // sentence used to move w_dir, so it flipped ~160 degrees three times a
    // second. Only the MWD carries a direction, so only it should.
    const live = createNmeaLiveData();
    const seen = new Set<number>();
    for (const s of [
      withChecksum('IIMWV,024.5,R,014.7,N,A'),
      withChecksum('IIMWV,021.3,T,014.1,N,A'),
      withChecksum('IIMWD,232.8,T,246.8,M,14.1,N,7.3,M'),
    ]) {
      handleNmeaSentence(s, live);
      if (live.w_dir !== null) seen.add(live.w_dir);
    }
    expect([...seen]).toEqual([232.8]);
  });
});
