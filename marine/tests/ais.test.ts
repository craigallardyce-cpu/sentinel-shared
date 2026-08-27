import { describe, it, expect } from 'vitest';
import { parseAisSentence, calculateTargetMetrics, getUpdatedAisTargets } from '../src/ais.js';

/**
 * Independent bit-level AIVDM encoder (the inverse of the module's private
 * decoder) used only to build valid test fixtures. Hand-writing a correct
 * armored AIVDM payload from memory isn't practical or verifiable, so
 * instead this constructs one field-by-field at the same bit offsets the
 * parser reads, and round-trips it through the real parseAisSentence.
 */
function setBitsInt(bits: number[], start: number, length: number, value: number, signed = false): void {
  let v = value;
  if (signed && v < 0) {
    v = v + (1 << length);
  }
  for (let i = length - 1; i >= 0; i--) {
    bits[start + i] = v & 1;
    v = v >> 1;
  }
}

function encode6BitPayload(bits: number[]): string {
  const padded = bits.slice();
  while (padded.length % 6 !== 0) padded.push(0);

  let payload = '';
  for (let i = 0; i < padded.length; i += 6) {
    let val = 0;
    for (let b = 0; b < 6; b++) {
      val = (val << 1) | padded[i + b];
    }
    // Inverse of charTo6Bit: 0-39 -> code+48, 40-63 -> code+48+8
    const code = val < 40 ? val + 48 : val + 48 + 8;
    payload += String.fromCharCode(code);
  }
  return payload;
}

function withChecksum(payloadWithoutBangOrStar: string): string {
  let checksum = 0;
  for (const ch of payloadWithoutBangOrStar) {
    checksum ^= ch.charCodeAt(0);
  }
  const hex = checksum.toString(16).toUpperCase().padStart(2, '0');
  return `!${payloadWithoutBangOrStar}*${hex}`;
}

function buildType1Sentence(opts: {
  talker?: 'AIVDM' | 'AIVDO';
  mmsi: number;
  lat: number;
  lon: number;
  sogKnots: number;
  cogDeg: number;
  headingDeg: number;
}): string {
  const bits: number[] = new Array(168).fill(0);
  setBitsInt(bits, 0, 6, 1); // msgType 1
  setBitsInt(bits, 8, 30, opts.mmsi);
  setBitsInt(bits, 50, 10, Math.round(opts.sogKnots * 10));
  setBitsInt(bits, 61, 28, Math.round(opts.lon * 600000), true);
  setBitsInt(bits, 89, 27, Math.round(opts.lat * 600000), true);
  setBitsInt(bits, 116, 12, Math.round(opts.cogDeg * 10));
  setBitsInt(bits, 128, 9, Math.round(opts.headingDeg));

  const armored = encode6BitPayload(bits);
  const talker = opts.talker || 'AIVDM';
  return withChecksum(`${talker},1,1,,A,${armored},0`);
}

describe('parseAisSentence', () => {
  it('round-trips a Class A position report (AIVDM)', () => {
    const sentence = buildType1Sentence({
      mmsi: 366123456,
      lat: 41.5,
      lon: -71.3,
      sogKnots: 12.3,
      cogDeg: 88.5,
      headingDeg: 90
    });

    const result = parseAisSentence(sentence);
    expect(result).not.toBeNull();
    expect(result!.mmsi).toBe('366123456');
    expect(result!.type).toBe('AIS Class A');
    expect(result!.lat).toBeCloseTo(41.5, 5);
    expect(result!.lon).toBeCloseTo(-71.3, 5);
    expect(result!.sog).toBeCloseTo(12.3, 5);
    expect(result!.cog).toBeCloseTo(88.5, 5);
    expect(result!.isOwnVessel).toBe(false);
  });

  it('marks AIVDO sentences as own vessel', () => {
    const sentence = buildType1Sentence({
      talker: 'AIVDO',
      mmsi: 366987654,
      lat: 41.2,
      lon: -71.8,
      sogKnots: 5.0,
      cogDeg: 180,
      headingDeg: 180
    });

    const result = parseAisSentence(sentence);
    expect(result).not.toBeNull();
    expect(result!.isOwnVessel).toBe(true);
  });

  it('rejects sentences that are not AIVDM/AIVDO', () => {
    expect(parseAisSentence('$GPRMC,foo*00')).toBeNull();
  });

  it('rejects malformed sentences with too few fields', () => {
    expect(parseAisSentence('!AIVDM,1,1*00')).toBeNull();
  });
});

describe('calculateTargetMetrics', () => {
  it('returns SAFE placeholders for invalid coordinates', () => {
    const metrics = calculateTargetMetrics(NaN, -71, 0, 0, 41, -71, 0, 0);
    expect(metrics.threatLevel).toBe('SAFE');
    expect(metrics.rangeVal).toBe(Infinity);
  });

  it('flags a closing target on a collision course as ADVISORY', () => {
    // Target 1 NM due north, closing head-on toward own ship.
    const metrics = calculateTargetMetrics(41.0, -71.0, 10, 0, 41.0 + 1 / 60, -71.0, 10, 180);
    expect(metrics.threatLevel).toBe('ADVISORY');
    expect(metrics.tcpaVal).toBeGreaterThan(0);
  });

  it('leaves a stationary distant target as SAFE', () => {
    const metrics = calculateTargetMetrics(41.0, -71.0, 0, 0, 41.5, -71.5, 0, 0);
    expect(metrics.threatLevel).toBe('SAFE');
  });

  it('marks a target within 2 NM as ADVISORY even while moving away (close-quarters margin)', () => {
    // Within 2 NM, the threat check flags proximity regardless of trajectory —
    // a deliberate close-quarters margin, not a CPA/TCPA projection.
    const metrics = calculateTargetMetrics(41.0, -71.0, 0, 0, 41.0 + 0.2 / 60, -71.0, 15, 0);
    expect(metrics.threatLevel).toBe('ADVISORY');
  });

  it('marks a distant target moving directly away as SAFE', () => {
    // 3 NM north, heading further north at 15 kts: already past closest
    // approach and outside the close-quarters margin.
    const metrics = calculateTargetMetrics(41.0, -71.0, 0, 0, 41.0 + 3 / 60, -71.0, 15, 0);
    expect(metrics.threatLevel).toBe('SAFE');
  });
});

describe('getUpdatedAisTargets', () => {
  it('invents no targets of its own', () => {
    // This used to inject three demo vessels at fixed offsets from own ship.
    // They followed the boat around, so any proximity limit wide enough to
    // reach them alarmed permanently about vessels that were not there, and
    // every caller needed its own filter to ignore them. An empty feed must
    // show an empty list.
    const { targetsList, targetsMap } = getUpdatedAisTargets(new Map(), 41.0, -71.0);
    expect(targetsList).toEqual([]);
    expect(targetsMap.size).toBe(0);
  });

  it('excludes a target matching the configured own MMSI', () => {
    const ownMmsi = '235123456';
    const map = new Map<string, any>([
      [ownMmsi, { mmsi: ownMmsi, lat: 41.01, lon: -71.01, sog: 0, cog: 0, lastSeen: Date.now() }]
    ]);
    const { targetsList } = getUpdatedAisTargets(map, 41.0, -71.0, 0, 0, ownMmsi);
    expect(targetsList.find(t => t.mmsi === ownMmsi)).toBeUndefined();
  });

  it('keeps a target that is very close but is not us', () => {
    // The rule this pins down: proximity must never remove a target. A boat
    // anchoring alongside is the single most important thing an anchor watch
    // can show, and a blanket 0.03 NM cutoff used to swallow it whole.
    const closeMmsi = '338204512';   // ~40 ft away, no own MMSI supplied
    const map = new Map<string, any>([
      [closeMmsi, { mmsi: closeMmsi, lat: 41.0 + 0.00011, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }]
    ]);
    const { targetsList } = getUpdatedAisTargets(map, 41.0, -71.0);
    expect(targetsList.find(t => t.mmsi === closeMmsi)).toBeDefined();
  });

  it('removes own ship by identity however close or far it is', () => {
    const own = '316001234';
    for (const dLat of [0.00011, 0.5]) {
      const map = new Map<string, any>([
        [own, { mmsi: own, lat: 41.0 + dLat, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }]
      ]);
      const { targetsList } = getUpdatedAisTargets(map, 41.0, -71.0, 0, 0, own);
      expect(targetsList.find(t => t.mmsi === own)).toBeUndefined();
    }
  });

  it('accepts several own-ship identities at once', () => {
    // Callers know their MMSI from settings, the vessel profile and AIVDO, and
    // should be able to offer all of them rather than picking one.
    const configured = '316001234', latched = '338204512', other = '367445890';
    const map = new Map<string, any>([
      [configured, { mmsi: configured, lat: 41.01, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }],
      [latched, { mmsi: latched, lat: 41.02, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }],
      [other, { mmsi: other, lat: 41.03, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }]
    ]);
    const { targetsList } = getUpdatedAisTargets(map, 41.0, -71.0, 0, 0, [configured, null, latched]);
    expect(targetsList.map(t => t.mmsi)).toEqual([other]);
  });

  it('removes an AIVDO-flagged target regardless of range', () => {
    const map = new Map<string, any>([
      ['316009999', { mmsi: '316009999', lat: 41.4, lon: -71.0, sog: 0, cog: 0, isOwnVessel: true, lastSeen: Date.now() }]
    ]);
    const { targetsList } = getUpdatedAisTargets(map, 41.0, -71.0);
    expect(targetsList).toEqual([]);
  });

  it('purges targets that have gone stale', () => {
    const staleMap = new Map<string, any>([
      ['999999999', { mmsi: '999999999', lat: 41.01, lon: -71.01, sog: 0, cog: 0, lastSeen: Date.now() - 700000 }]
    ]);
    const { targetsList, targetsMap } = getUpdatedAisTargets(staleMap, 41.0, -71.0);
    expect(targetsMap.has('999999999')).toBe(false);
    expect(targetsList.find(t => t.mmsi === '999999999')).toBeUndefined();
  });

  it('sorts the target list by ascending range', () => {
    const map = new Map<string, any>([
      ['111111111', { mmsi: '111111111', lat: 41.0 + 0.5, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }],
      ['222222222', { mmsi: '222222222', lat: 41.0 + 0.05, lon: -71.0, sog: 0, cog: 0, lastSeen: Date.now() }]
    ]);
    const { targetsList } = getUpdatedAisTargets(map, 41.0, -71.0);
    const closeIdx = targetsList.findIndex(t => t.mmsi === '222222222');
    const farIdx = targetsList.findIndex(t => t.mmsi === '111111111');
    expect(closeIdx).toBeLessThan(farIdx);
  });
});
