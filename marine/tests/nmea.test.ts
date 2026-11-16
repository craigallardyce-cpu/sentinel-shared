import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  validateNmeaChecksum,
  parseNmeaLatitude,
  parseNmeaLongitude,
  formatCoords,
  parseNmeaSentence,
  handleNmeaSentence,
  createNmeaLiveData,
  isFixFresh,
  FIX_MAX_AGE_MS,
  resolveTrueHeading,
  resolveDepth,
  createDepthState,
  DEPTH_DATUM_HOLD_MS,
  WIND_TRUE_HOLD_MS
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
    const sentence = withChecksum('WIMWD,270.0,T,,,12.5,N,6.4,M');
    const result = parseNmeaSentence(sentence);
    expect(result).not.toBeNull();
    expect(result.twd).toBeCloseTo(270.0, 6);
    expect(result.tws).toBeCloseTo(12.5, 6);
  });

  it('does not call a magnetic MWD direction true, or its speed apparent', () => {
    // The true field is empty: the bearing is magnetic and has to say so.
    const result = parseNmeaSentence(withChecksum('WIMWD,,,270.0,M,12.5,N,6.4,M'));
    expect(result.twd).toBeUndefined();
    expect(result.twdMagnetic).toBeCloseTo(270.0, 6);
    expect(result.tws).toBeCloseTo(12.5, 6);
    // MWD is the true wind. It used to be written into aws and awd as well.
    expect('aws' in result).toBe(false);
    expect('awd' in result).toBe(false);
  });

  it('corrects a magnetic MWD direction by the variation once the feed gives one', () => {
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('WIMWD,,,270.0,M,12.5,N,6.4,M'), live);
    expect(live.w_dir).toBeCloseTo(270, 6); // No variation yet: used as it is.
    handleNmeaSentence(withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,010.0,W'), live);
    handleNmeaSentence(withChecksum('WIMWD,,,270.0,M,12.5,N,6.4,M'), live);
    expect(live.w_dir).toBeCloseTo(260, 6);
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

  it('reads VWR apparent wind from the raw angle field, port or starboard', () => {
    // Pins the output exactly, so the validity-only angle check cannot drift
    // from what the computed bearing it replaced used to allow.
    expect(parseNmeaSentence(withChecksum('IIVWR,024.5,R,014.7,N,,,,'))).toEqual({ awa: '024.5° STBD', aws: 14.7 });
    expect(parseNmeaSentence(withChecksum('IIVWR,030.0,l,012.0,N,,,,'))).toEqual({ awa: '030.0° PORT', aws: 12 });
    expect(parseNmeaSentence(withChecksum('IIVWR,030.0,L,,N,5.0,M,,'))).toEqual({ awa: '030.0° PORT', aws: 5 * 1.94384 });
  });

  it('rejects a VWR with no usable angle or no side', () => {
    for (const body of ['IIVWR,,R,014.7,N,,,,', 'IIVWR,abc,R,014.7,N,,,,', 'IIVWR,024.5,,014.7,N,,,,']) {
      const result = parseNmeaSentence(withChecksum(body));
      expect(result?.awa).toBeUndefined();
    }
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

/**
 * Fix age, which is not update age.
 *
 * A boat's instruments do not stop when its GPS does: the depth sounder and the
 * wind vane carry on, and every one of their sentences used to move the only
 * timestamp there was. An anchor watch reading it saw a feed that looked live
 * while the position under the alarm stood still.
 */
describe('fix age', () => {
  afterEach(() => vi.useRealTimers());

  const RMC = withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W');
  const DBT = withChecksum('SDDBT,036.8,f,011.2,M,006.1,F');

  it('starts with no fix at all', () => {
    const live = createNmeaLiveData();
    expect(live.lastFixAt).toBeNull();
    expect(isFixFresh(live.lastFixAt)).toBe(false);
  });

  it('stamps a fix when a position is accepted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const live = createNmeaLiveData();

    handleNmeaSentence(RMC, live);

    expect(live.lastFixAt).toBe(Date.now());
    expect(isFixFresh(live.lastFixAt)).toBe(true);
  });

  it('leaves the fix time alone for a sentence that carries no position', () => {
    // The regression in one test: a depth sounding must not make the position
    // look newer than it is.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const live = createNmeaLiveData();
    handleNmeaSentence(RMC, live);
    const fixedAt = live.lastFixAt;

    vi.setSystemTime(new Date('2026-09-27T12:00:30Z'));
    handleNmeaSentence(DBT, live);

    expect(live.lastFixAt).toBe(fixedAt);
    expect(live.lastUpdate).toBe(Date.now());
    expect(isFixFresh(live.lastFixAt)).toBe(false);
  });

  it('rejects a position the receiver marked void without stamping it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const live = createNmeaLiveData();

    handleNmeaSentence(withChecksum('GPRMC,123519,V,4807.038,N,01131.000,E,022.4,084.4,230394,,'), live);

    expect(live.lastFixAt).toBeNull();
  });
});

describe('isFixFresh', () => {
  it('is false for a feed that has never had a fix', () => {
    expect(isFixFresh(null, 1000)).toBe(false);
    expect(isFixFresh(undefined, 1000)).toBe(false);
  });

  it('holds a fix live right up to the limit and not past it', () => {
    const at = 1_000_000;
    expect(isFixFresh(at, at)).toBe(true);
    expect(isFixFresh(at, at + FIX_MAX_AGE_MS - 1)).toBe(true);
    expect(isFixFresh(at, at + FIX_MAX_AGE_MS)).toBe(true);
    expect(isFixFresh(at, at + FIX_MAX_AGE_MS + 1)).toBe(false);
  });

  it('is ten seconds, which is the decision the alarm rests on', () => {
    expect(FIX_MAX_AGE_MS).toBe(10_000);
  });

  it('takes a caller-supplied age, for an alarm on a different clock', () => {
    const at = 1_000_000;
    expect(isFixFresh(at, at + 3000, 2000)).toBe(false);
    expect(isFixFresh(at, at + 3000, 5000)).toBe(true);
  });

  it('calls a fix from the future fresh rather than stale', () => {
    // A gateway whose clock is ahead should not read as a lost position.
    expect(isFixFresh(2_000_000, 1_000_000)).toBe(true);
  });
});

/**
 * Heading. Course over ground is where the boat is going and heading is where
 * it points; RMC used to hand back the first as the second, VHW's magnetic
 * heading went into the same field, and the HDG sentence's own heading was
 * thrown away. So `heading` alternated between two different things, and at
 * anchor it was GPS course noise.
 */
describe('heading', () => {
  it('RMC gives course over ground and no heading', () => {
    const result = parseNmeaSentence(withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W'));
    expect(result.cog).toBeCloseTo(84.4, 6);
    expect('heading' in result).toBe(false);
    expect(result.magVar).toBeCloseTo(-3.1, 6);
  });

  it('RMC leaves out what the sentence left empty, so a merge keeps what it had', () => {
    // No speed, course or variation in this one.
    const result = parseNmeaSentence(withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,,,230394,,'));
    expect(result.latDec).toBeCloseTo(48 + 7.038 / 60, 6);
    for (const key of ['sog', 'cog', 'heading', 'magVar']) {
      expect(key in result).toBe(false);
    }
    // The merge OceanSentinel does: HDG's variation survives the next RMC.
    const held = { magVar: -14.2 };
    Object.assign(held, result);
    expect(held.magVar).toBe(-14.2);
  });

  it('reads HDT as a true heading', () => {
    expect(parseNmeaSentence(withChecksum('HEHDT,274.5,T')).heading).toBeCloseTo(274.5, 6);
  });

  it('reads HDM as a magnetic heading', () => {
    const result = parseNmeaSentence(withChecksum('HCHDM,238.5,M'));
    expect(result.headingMagnetic).toBeCloseTo(238.5, 6);
    expect('heading' in result).toBe(false);
  });

  it('reads HDG: sensor plus deviation is magnetic, plus variation is true', () => {
    const result = parseNmeaSentence(withChecksum('HCHDG,098.3,1.5,E,12.6,W'));
    expect(result.headingMagnetic).toBeCloseTo(99.8, 6);
    expect(result.heading).toBeCloseTo(87.2, 6);
    expect(result.magVar).toBeCloseTo(-12.6, 6);
  });

  it('reads an HDG with no variation as magnetic only', () => {
    const result = parseNmeaSentence(withChecksum('HCHDG,098.3,,,,'));
    expect(result.headingMagnetic).toBeCloseTo(98.3, 6);
    expect('heading' in result).toBe(false);
    expect('magVar' in result).toBe(false);
  });

  it('wraps an HDG heading that crosses north', () => {
    const result = parseNmeaSentence(withChecksum('HCHDG,005.0,,,10.0,W'));
    expect(result.heading).toBeCloseTo(355, 6);
  });

  it('reads THS only when the mode is a real reading', () => {
    expect(parseNmeaSentence(withChecksum('GPTHS,077.5,A')).heading).toBeCloseTo(77.5, 6);
    expect(parseNmeaSentence(withChecksum('GPTHS,077.5,E'))).toBeNull();
    expect(parseNmeaSentence(withChecksum('GPTHS,077.5,V'))).toBeNull();
  });

  it('keeps VHW true and magnetic headings apart', () => {
    const both = parseNmeaSentence(withChecksum('VWVHW,115.6,T,129.8,M,6.2,N,11.5,K'));
    expect(both.heading).toBeCloseTo(115.6, 6);
    expect(both.headingMagnetic).toBeCloseTo(129.8, 6);
    expect(both.stw).toBeCloseTo(6.2, 6);

    const magneticOnly = parseNmeaSentence(withChecksum('VWVHW,,,129.8,M,6.2,N,,'));
    expect('heading' in magneticOnly).toBe(false);
    expect(magneticOnly.headingMagnetic).toBeCloseTo(129.8, 6);

    const speedOnly = parseNmeaSentence(withChecksum('VWVHW,,,,,6.2,N,,'));
    expect(speedOnly).toEqual({ stw: 6.2 });
  });

  it('resolveTrueHeading prefers a true heading, then magnetic plus variation, and never a course', () => {
    expect(resolveTrueHeading({ heading: 12, headingMagnetic: 30, magVar: -10 })).toBe(12);
    expect(resolveTrueHeading({ headingMagnetic: 5, magVar: -10 })).toBe(355);
    expect(resolveTrueHeading({ headingMagnetic: 5 })).toBeUndefined();
    expect(resolveTrueHeading({})).toBeUndefined();
  });
});

/**
 * A fix the receiver does not have. Quality 6 and mode E are dead reckoning:
 * the receiver has lost its satellites and is extrapolating. Each such sentence
 * used to count as a fix and refresh `lastFixAt`, so the position-lost alarm
 * stayed quiet.
 */
describe('engine revolutions', () => {
  it('reads RPM from an engine or a shaft', () => {
    expect(parseNmeaSentence(withChecksum('IIRPM,E,1,1850.0,,A'))).toEqual({ engineRpm: 1850, engineNumber: 1 });
    expect(parseNmeaSentence(withChecksum('IIRPM,S,2,-640.5,10.0,A'))).toEqual({ engineRpm: 640.5, engineNumber: 2 });
    expect(parseNmeaSentence(withChecksum('IIRPM,E,1,0.0,,A'))).toEqual({ engineRpm: 0, engineNumber: 1 });
  });

  it('refuses a reading marked invalid, or with no figure', () => {
    expect(parseNmeaSentence(withChecksum('IIRPM,E,1,1850.0,,V'))).toBeNull();
    expect(parseNmeaSentence(withChecksum('IIRPM,E,1,,,A'))).toBeNull();
  });
});

describe('fix quality', () => {
  const gga = (quality: string) =>
    parseNmeaSentence(withChecksum(`GPGGA,123519,4807.038,N,01131.000,E,${quality},08,0.9,545.4,M,46.9,M,,`));

  it('accepts GPS, differential, PPS, RTK and simulator qualities', () => {
    for (const quality of ['1', '2', '3', '4', '5', '8']) {
      expect(gga(quality), `quality ${quality}`).not.toBeNull();
    }
  });

  it('refuses no fix, estimated, manual and an unreadable quality', () => {
    for (const quality of ['0', '6', '7', '', 'x', '9']) {
      expect(gga(quality), `quality "${quality}"`).toBeNull();
    }
  });

  it('refuses an RMC whose mode is estimated, manual or not valid', () => {
    const rmc = (mode: string) =>
      parseNmeaSentence(withChecksum(`GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W,${mode}`));
    for (const mode of ['A', 'D', 'F', 'P', 'R', 'S']) expect(rmc(mode), `mode ${mode}`).not.toBeNull();
    for (const mode of ['E', 'M', 'N']) expect(rmc(mode), `mode ${mode}`).toBeNull();
  });

  it('takes an RMC with no mode field at its status flag', () => {
    expect(parseNmeaSentence(withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,'))).not.toBeNull();
  });

  it('refuses a GLL whose mode is estimated', () => {
    expect(parseNmeaSentence(withChecksum('GPGLL,4807.038,N,01131.000,E,123519,A,A'))).not.toBeNull();
    expect(parseNmeaSentence(withChecksum('GPGLL,4807.038,N,01131.000,E,123519,A,E'))).toBeNull();
  });

  it('does not refresh lastFixAt from a dead-reckoned sentence', () => {
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('GPGGA,123519,4807.038,N,01131.000,E,6,08,0.9,545.4,M,46.9,M,,'), live);
    expect(live.lastFixAt).toBeNull();
    expect(live.lat).toBeNull();
  });

  it('refuses a position that cannot exist', () => {
    expect(parseNmeaLatitude('9100.000', 'N')).toBeNull();
    expect(parseNmeaLatitude('4860.000', 'N')).toBeNull();
    expect(parseNmeaLongitude('18100.000', 'E')).toBeNull();
    expect(parseNmeaLongitude('01160.500', 'E')).toBeNull();
    expect(parseNmeaLatitude('9000.000', 'S')).toBe(-90);
    expect(parseNmeaLongitude('18000.000', 'W')).toBe(-180);
  });

  it('carries 59.9996 minutes into the degrees', () => {
    expect(formatCoords(41 + 59.9996 / 60, -(71 + 59.9996 / 60))).toEqual({
      latStr: "N 42° 00.000'",
      lngStr: "W 072° 00.000'"
    });
  });
});

/**
 * Depth, and what it is measured from. A sounder set up with a keel offset
 * reports depth below the keel; that was added up as if the offset ran to the
 * waterline and handed on as depth of water.
 */
describe('depth datum', () => {
  it('reports each depth sentence on its own datum, in metres', () => {
    expect(parseNmeaSentence(withChecksum('SDDBT,,,4.9,M,,')).depthBelowTransducer).toBeCloseTo(4.9, 6);
    expect(parseNmeaSentence(withChecksum('SDDBK,,,3.2,M,,')).depthBelowKeel).toBeCloseTo(3.2, 6);
    expect(parseNmeaSentence(withChecksum('SDDBS,,,5.4,M,,')).depthBelowSurface).toBeCloseTo(5.4, 6);
    const dpt = parseNmeaSentence(withChecksum('IIDPT,4.5,-1.5'));
    expect(dpt.depthBelowTransducer).toBeCloseTo(4.5, 6);
    expect(dpt.transducerOffset).toBeCloseTo(-1.5, 6);
  });

  it('reads a depth given only in fathoms', () => {
    expect(parseNmeaSentence(withChecksum('SDDBT,,,,,2.7,F')).depthBelowTransducer).toBeCloseTo(2.7 * 1.8288, 6);
  });

  it('a positive DPT offset gives depth of water', () => {
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIDPT,4.5,0.5'), live);
    expect(live.depth_datum).toBe('surface');
    expect(live.depth).toBeCloseTo(5.0 / 0.3048, 6);
  });

  it('a negative DPT offset gives depth below the keel, and says so', () => {
    // 5 m of water, transducer 0.5 m down, keel 1.5 m below the transducer.
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIDPT,4.5,-1.5'), live);
    expect(live.depth_datum).toBe('keel');
    expect(live.depth).toBeCloseTo(3.0 / 0.3048, 6);
    expect(live.depth_offset_ft).toBeCloseTo(-1.5 / 0.3048, 6);
    // DBT from the same sounder lands on the same datum.
    handleNmeaSentence(withChecksum('IIDBT,,,4.5,M,,'), live);
    expect(live.depth_datum).toBe('keel');
    expect(live.depth).toBeCloseTo(3.0 / 0.3048, 6);
  });

  it('a DPT with no offset is a transducer reading', () => {
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIDPT,4.5,'), live);
    expect(live.depth_datum).toBe('transducer');
    expect(live.depth).toBeCloseTo(4.5 / 0.3048, 6);
  });

  it('holds the best datum when a sounder sends DBT, DBK and DBS', () => {
    const state = createDepthState();
    const t0 = 1_000_000;
    const feed = [
      { depthBelowTransducer: 4.5 },
      { depthBelowKeel: 3.0 },
      { depthBelowSurface: 5.0 },
      { depthBelowTransducer: 4.5 },
      { depthBelowKeel: 3.0 },
      { depthBelowSurface: 5.1 }
    ];
    const accepted = feed.map((parsed, i) => resolveDepth(state, parsed, t0 + i * 300));
    // The first two are taken while nothing better has been seen; once the
    // surface reading arrives it is the only one accepted.
    expect(accepted.map((r) => r?.datum ?? null)).toEqual(['transducer', 'keel', 'surface', null, null, 'surface']);
    expect(accepted[5]?.depthM).toBe(5.1);
  });

  it('prefers a keel reading to a bare transducer reading', () => {
    const state = createDepthState();
    expect(resolveDepth(state, { depthBelowKeel: 3.0 }, 0)?.datum).toBe('keel');
    expect(resolveDepth(state, { depthBelowTransducer: 4.5 }, 500)).toBeNull();
  });

  it('falls back to a worse datum when the better one stops', () => {
    const state = createDepthState();
    resolveDepth(state, { depthBelowSurface: 5.0 }, 0);
    expect(resolveDepth(state, { depthBelowTransducer: 4.5 }, DEPTH_DATUM_HOLD_MS)).toBeNull();
    expect(resolveDepth(state, { depthBelowTransducer: 4.5 }, DEPTH_DATUM_HOLD_MS + 1)?.datum).toBe('transducer');
  });

  it('works on a live-data object built before depth_state existed', () => {
    const live = createNmeaLiveData();
    delete live.depth_state;
    handleNmeaSentence(withChecksum('IIDPT,4.5,0.5'), live);
    expect(live.depth_datum).toBe('surface');
  });
});

/** True wind where the feed has it; apparent only when it does not. */
describe('wind speed reference', () => {
  afterEach(() => vi.useRealTimers());

  it('does not let apparent wind replace a recent true wind', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIMWV,021.3,T,014.1,N,A'), live);
    vi.advanceTimersByTime(300);
    handleNmeaSentence(withChecksum('IIMWV,024.5,R,019.7,N,A'), live);
    expect(live.w_speed).toBeCloseTo(14.1, 6);
    expect(live.w_speed_ref).toBe('true');
  });

  it('uses apparent wind when the feed has no true wind', () => {
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIMWV,024.5,R,019.7,N,A'), live);
    expect(live.w_speed).toBeCloseTo(19.7, 6);
    expect(live.w_speed_ref).toBe('apparent');
  });

  it('goes back to apparent wind when the true wind stops', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const live = createNmeaLiveData();
    handleNmeaSentence(withChecksum('IIMWV,021.3,T,014.1,N,A'), live);
    vi.advanceTimersByTime(WIND_TRUE_HOLD_MS + 1);
    handleNmeaSentence(withChecksum('IIMWV,024.5,R,019.7,N,A'), live);
    expect(live.w_speed).toBeCloseTo(19.7, 6);
    expect(live.w_speed_ref).toBe('apparent');
  });
});
