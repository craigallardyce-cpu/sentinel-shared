/**
 * AIS (AIVDM/AIVDO) decoding and tactical collision-assessment utilities
 * shared across the Mariner Sentinel fleet.
 */

export interface AisTargetData {
  mmsi: string;
  name?: string;
  callSign?: string;
  type?: string;
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number;
  isOwnVessel?: boolean;
  lastSeen?: number;
}

/**
 * Relative-motion figures for one target against own ship.
 *
 * Every angle here is TRUE, not magnetic. Bearings are derived from geographic
 * coordinates and COG comes straight off the AIS report, which is referenced to
 * true north; no magnetic variation is applied anywhere in this module.
 */
export interface TargetMetrics {
  rangeVal: number;
  /** True bearing to the target, degrees 0-360. */
  bearingVal: number;
  cpaVal: number;
  tcpaVal: number;
  range: string;
  bearing: string;
  cpa: string;
  tcpa: string;
  threatLevel: 'SAFE' | 'ADVISORY';
}

/**
 * A decoded target after getUpdatedAisTargets has enriched it with relative
 * motion against own ship.
 *
 * The display strings are deliberately named apart from the numeric fields they
 * are derived from. `heading` stays what the decoder produced -- the target's
 * true heading in degrees -- and is no longer overwritten with a formatted
 * course string, which had made it a number by declaration and a string in
 * practice. Anything needing course over ground should read the numeric `cog`.
 */
export interface AisTargetEnriched extends AisTargetData, TargetMetrics {
  id: string;
  name: string;
  sog: number;
  cog: number;
  /** [lat, lon], convenient for Leaflet. */
  coords: [number, number];
  /** SOG formatted for display, e.g. "5.2 kts". */
  sogText: string;
  /**
   * COG formatted for display, e.g. "045° T". True, not magnetic: AIS position
   * reports carry COG relative to true north and nothing here applies variation.
   */
  cogText: string;
}

/**
 * How long a partly-assembled multipart AIVDM may wait for the rest of it.
 *
 * A gateway sends the fragments of one message back to back, so two seconds is
 * many times longer than a complete message ever takes. It is short enough that
 * a partial cannot survive to meet a fragment of an unrelated message.
 */
export const AIS_FRAGMENT_TIMEOUT_MS = 2_000;

/**
 * How many partly-assembled messages to hold at once.
 *
 * A busy anchorage has a handful in flight; anything beyond this is fragments
 * that will never complete, and an unbounded map of them is a slow leak in a
 * process that runs for weeks. The oldest goes first.
 */
const AIS_MAX_PARTIALS = 64;

interface AivdmPartial {
  /** Fragment payloads by index, `fragments[k - 1]` for fragment k. */
  fragments: string[];
  /** How many of them are present. */
  received: number;
  /** When fragment 1 arrived, for the timeout. */
  startedAt: number;
}

/**
 * Multi-sentence AIVDM reassembly, keyed talker + sequence id + fragment count.
 *
 * The key is not unique to a message -- it repeats every time the sequence id
 * comes round -- which is fine over TCP, where fragments arrive in order and
 * none goes missing. **UDP loses datagrams**, and the naive version of this
 * (fill a sparse array, complete when it is full, no timeout, no ordering, no
 * cap) then splices two different messages: lose fragment 1 of message A, and
 * the fragment 1 of message B that follows completes A's buffer as B1 + A2.
 * That decodes cleanly into a target at a position no vessel is at.
 *
 * So the rules are: fragment k is accepted only when 1..k-1 are already here,
 * a fragment 1 starts a new partial over whatever was there, anything older
 * than `AIS_FRAGMENT_TIMEOUT_MS` is discarded rather than completed, and a
 * rejected fragment takes the partial with it -- a gap can never be filled
 * later by a fragment of the next message.
 *
 * The limit of all this, stated rather than implied: once a fragment 1 has
 * begun a partial, a fragment 2 of the PREVIOUS message that turns up out of
 * order is accepted, because at that moment nothing in the sentence tells the
 * two apart -- same talker, same sequence id, same fragment count, same slot.
 * Loss is what UDP does to a feed and loss is closed here; a reordered
 * duplicate is beyond what this layer can see, and the timeout is what bounds
 * how long one can survive to be believed.
 */
const aivdmBuffers = new Map<string, AivdmPartial>();

/**
 * Forget every partly-assembled message.
 *
 * The buffers are module state, so one test's orphaned fragment is the next
 * test's. Exported for that, and harmless in an app: it discards only fragments
 * that have not yet made a target.
 */
export function resetAivdmBuffers(): void {
  aivdmBuffers.clear();
}

/** Drop partials that can no longer legitimately complete. */
function expireAivdmPartials(now: number): void {
  for (const [key, partial] of aivdmBuffers) {
    if (now - partial.startedAt > AIS_FRAGMENT_TIMEOUT_MS) aivdmBuffers.delete(key);
  }
}

/** Keep the map bounded. Insertion order is age order, so the first key is the oldest. */
function capAivdmPartials(): void {
  while (aivdmBuffers.size > AIS_MAX_PARTIALS) {
    const oldest = aivdmBuffers.keys().next();
    if (oldest.done) return;
    aivdmBuffers.delete(oldest.value);
  }
}

/** 6-bit ASCII armoring lookup for AIVDM payloads. */
function charTo6Bit(char: string): number {
  let code = char.charCodeAt(0) - 48;
  if (code > 40) code -= 8;
  return code & 0x3f;
}

/** Decodes 6-bit armored ASCII string to a binary bit array. */
function decode6BitPayload(payload: string): number[] {
  const bits: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const val = charTo6Bit(payload[i]);
    for (let b = 5; b >= 0; b--) {
      bits.push((val >> b) & 1);
    }
  }
  return bits;
}

/** Extract integer from a bit slice. */
function getBitsInt(bits: number[], start: number, length: number, signed = false): number {
  if (start + length > bits.length) return 0;
  let val = 0;
  for (let i = 0; i < length; i++) {
    val = (val << 1) | bits[start + i];
  }
  if (signed && bits[start] === 1) {
    val = val - (1 << length);
  }
  return val;
}

/** Decode 6-bit ASCII text string (6 bits per char). */
function getBitsText(bits: number[], start: number, length: number): string {
  let text = '';
  const numChars = Math.floor(length / 6);
  for (let i = 0; i < numChars; i++) {
    const code = getBitsInt(bits, start + i * 6, 6, false);
    if (code === 0) break; // End of string (@)
    if (code >= 1 && code <= 31) {
      text += String.fromCharCode(code + 64);
    } else if (code >= 32 && code <= 63) {
      text += String.fromCharCode(code);
    }
  }
  return text.trim();
}

/** Parses raw NMEA AIVDM / AIVDO sentences into AIS target data. */
export function parseAisSentence(sentence: string): AisTargetData | null {
  if (!sentence || (!sentence.startsWith('!') && !sentence.startsWith('$'))) return null;
  const starIdx = sentence.indexOf('*');
  const payload = starIdx >= 0 ? sentence.substring(0, starIdx) : sentence;
  const parts = payload.split(',');

  if (parts.length < 6) return null;
  const talker = parts[0].substring(1);
  if (talker !== 'AIVDM' && talker !== 'AIVDO') return null;

  const totalNum = parseInt(parts[1], 10);
  const seqNum = parseInt(parts[2], 10);
  const seqId = parts[3] || '0';
  const armPayload = parts[5];

  let fullPayload = armPayload;
  if (totalNum > 1) {
    if (!Number.isFinite(seqNum) || seqNum < 1 || seqNum > totalNum) return null;

    const key = `${talker}_${seqId}_${totalNum}`;
    const now = Date.now();
    expireAivdmPartials(now);

    let partial = aivdmBuffers.get(key);

    if (seqNum === 1) {
      // A first fragment always begins a new message. Whatever was under this
      // key was waiting for a fragment that is now provably never coming.
      partial = { fragments: new Array<string>(totalNum), received: 0, startedAt: now };
      // Deleted first so the restart takes a new place in insertion order:
      // `set` on a key already present keeps its old one, and the cap evicts by
      // that order.
      aivdmBuffers.delete(key);
      aivdmBuffers.set(key, partial);
      capAivdmPartials();
    } else {
      // Every earlier fragment must already be here. If one is missing this is
      // an orphan -- the tail of a message whose head was lost -- and keeping
      // the partial would let it be completed by the next message's fragments.
      let contiguous = partial !== undefined;
      if (partial) {
        for (let i = 0; i < seqNum - 1; i++) {
          if (!partial.fragments[i]) {
            contiguous = false;
            break;
          }
        }
        // A repeat of a fragment already held is not the message advancing.
        if (partial.fragments[seqNum - 1]) contiguous = false;
      }
      if (!contiguous) {
        aivdmBuffers.delete(key);
        return null;
      }
    }

    partial!.fragments[seqNum - 1] = armPayload;
    partial!.received += 1;

    if (partial!.received !== totalNum) return null; // Wait for remaining fragments

    fullPayload = partial!.fragments.join('');
    aivdmBuffers.delete(key);
  }

  // AIVDO = own vessel's AIS transponder, AIVDM = other vessels
  const isOwnVessel = talker === 'AIVDO';

  try {
    const bits = decode6BitPayload(fullPayload);
    const msgType = getBitsInt(bits, 0, 6);
    const mmsi = getBitsInt(bits, 8, 30).toString();

    // Position report (Types 1, 2, 3)
    if ([1, 2, 3].includes(msgType)) {
      const sogRaw = getBitsInt(bits, 50, 10);
      const sog = sogRaw < 1023 ? sogRaw / 10 : 0;

      const lonRaw = getBitsInt(bits, 61, 28, true);
      const latRaw = getBitsInt(bits, 89, 27, true);

      const lon = lonRaw / 600000;
      const lat = latRaw / 600000;

      const cogRaw = getBitsInt(bits, 116, 12);
      const cog = cogRaw < 3600 ? cogRaw / 10 : 0;

      const hdgRaw = getBitsInt(bits, 128, 9);
      const heading = hdgRaw > 0 && hdgRaw < 360 ? hdgRaw : cog;

      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && (lat !== 0 || lon !== 0)) {
        return {
          mmsi,
          type: 'AIS Class A',
          lat,
          lon,
          sog,
          cog,
          heading,
          isOwnVessel,
          lastSeen: Date.now()
        };
      }
    }

    // Class B Position report (Types 18, 19)
    if ([18, 19].includes(msgType)) {
      const sogRaw = getBitsInt(bits, 46, 10);
      const sog = sogRaw < 1023 ? sogRaw / 10 : 0;

      const lonRaw = getBitsInt(bits, 57, 28, true);
      const latRaw = getBitsInt(bits, 85, 27, true);

      const lon = lonRaw / 600000;
      const lat = latRaw / 600000;

      const cogRaw = getBitsInt(bits, 112, 12);
      const cog = cogRaw < 3600 ? cogRaw / 10 : 0;

      const hdgRaw = getBitsInt(bits, 124, 9);
      const heading = hdgRaw > 0 && hdgRaw < 360 ? hdgRaw : cog;

      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && (lat !== 0 || lon !== 0)) {
        return {
          mmsi,
          type: 'AIS Class B',
          lat,
          lon,
          sog,
          cog,
          heading,
          isOwnVessel,
          lastSeen: Date.now()
        };
      }
    }

    // Static Data Report (Type 5: Ship Name & Call Sign; Type 24)
    if (msgType === 5) {
      const callSign = getBitsText(bits, 70, 42);
      const name = getBitsText(bits, 112, 120);
      return {
        mmsi,
        name: name || `MMSI ${mmsi}`,
        callSign: callSign || '---',
        isOwnVessel,
        lastSeen: Date.now()
      };
    }

    if (msgType === 24) {
      const partNum = getBitsInt(bits, 38, 2);
      if (partNum === 0) {
        const name = getBitsText(bits, 40, 120);
        return { mmsi, name: name || `MMSI ${mmsi}`, isOwnVessel, lastSeen: Date.now() };
      } else if (partNum === 1) {
        const callSign = getBitsText(bits, 90, 42);
        return { mmsi, callSign: callSign || '---', isOwnVessel, lastSeen: Date.now() };
      }
    }
  } catch (err) {
    // Decoding error fallback
  }

  return null;
}

/** Calculates CPA, TCPA, Range, Bearing, and Threat Level between Own Ship and Target. */
export function calculateTargetMetrics(
  ownLat: number,
  ownLon: number,
  ownSog = 0,
  ownCog = 0,
  tgtLat: number,
  tgtLon: number,
  tgtSog = 0,
  tgtCog = 0
): TargetMetrics {
  const safeTgtSog = typeof tgtSog === 'number' && !isNaN(tgtSog) ? tgtSog : 0;
  const safeTgtCog = typeof tgtCog === 'number' && !isNaN(tgtCog) ? tgtCog : 0;
  const safeOwnSog = typeof ownSog === 'number' && !isNaN(ownSog) ? ownSog : 0;
  const safeOwnCog = typeof ownCog === 'number' && !isNaN(ownCog) ? ownCog : 0;

  if (
    typeof ownLat !== 'number' ||
    typeof ownLon !== 'number' ||
    typeof tgtLat !== 'number' ||
    typeof tgtLon !== 'number' ||
    isNaN(ownLat) ||
    isNaN(ownLon) ||
    isNaN(tgtLat) ||
    isNaN(tgtLon)
  ) {
    return {
      rangeVal: Infinity,
      bearingVal: 0,
      cpaVal: Infinity,
      tcpaVal: 0,
      range: '---',
      bearing: '---',
      cpa: '---',
      tcpa: '---',
      threatLevel: 'SAFE'
    };
  }

  const rad = Math.PI / 180;

  // Distance (Range in NM)
  const dLat = (tgtLat - ownLat) * 60;
  const dLon = (tgtLon - ownLon) * 60 * Math.cos(((ownLat + tgtLat) / 2) * rad);
  const distNM = Math.sqrt(dLat * dLat + dLon * dLon);

  // Bearing (degrees 0-360)
  let bearingDeg = Math.atan2(dLon, dLat) / rad;
  if (bearingDeg < 0) bearingDeg += 360;

  // Velocity vectors in knots (X = East, Y = North)
  const vOwnX = safeOwnSog * Math.sin(safeOwnCog * rad);
  const vOwnY = safeOwnSog * Math.cos(safeOwnCog * rad);

  const vTgtX = safeTgtSog * Math.sin(safeTgtCog * rad);
  const vTgtY = safeTgtSog * Math.cos(safeTgtCog * rad);

  // Relative position (Target relative to Own Ship)
  const rx = dLon; // NM
  const ry = dLat; // NM

  // Relative velocity (Target relative to Own Ship)
  const rvx = vTgtX - vOwnX; // kts
  const rvy = vTgtY - vOwnY; // kts

  const rv2 = rvx * rvx + rvy * rvy;

  let cpaNM = distNM;
  let tcpaMin = 0;
  let isPassed = false;

  if (rv2 > 0.0001) {
    const tCpaHours = -(rx * rvx + ry * rvy) / rv2;
    if (tCpaHours < 0) {
      isPassed = true;
      tcpaMin = 0;
      cpaNM = distNM;
    } else {
      const cpaX = rx + rvx * tCpaHours;
      const cpaY = ry + rvy * tCpaHours;
      cpaNM = Math.sqrt(cpaX * cpaX + cpaY * cpaY);
      tcpaMin = tCpaHours * 60;
    }
  }

  const rangeStr = `${distNM.toFixed(1)} NM`;
  const bearingStr = `${Math.round(bearingDeg).toString().padStart(3, '0')}°`;
  const cpaStr = `${cpaNM.toFixed(1)} NM`;

  let tcpaStr = '00m 00s';
  if (isPassed) {
    tcpaStr = 'PASSED';
  } else {
    const mins = Math.floor(tcpaMin);
    const secs = Math.floor((tcpaMin - mins) * 60);
    tcpaStr = `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }

  // Threat assessment: ADVISORY if CPA/TCPA indicate close quarters.
  const isThreat = (cpaNM <= 0.8 && tcpaMin <= 20 && !isPassed) || (distNM <= 2.0 && cpaNM <= 0.5);
  const threatLevel = isThreat ? 'ADVISORY' : 'SAFE';

  return {
    rangeVal: distNM,
    bearingVal: bearingDeg,
    cpaVal: cpaNM,
    tcpaVal: tcpaMin,
    range: rangeStr,
    bearing: bearingStr,
    cpa: cpaStr,
    tcpa: tcpaStr,
    threatLevel
  };
}

/**
 * Generates or updates the target list, recalculating relative motion against
 * own ship.
 *
 * Own ship is identified by IDENTITY ONLY — never by how close a target is.
 * A vessel is recognised as ourselves when it arrives as AIVDO, when it carries
 * an MMSI already latched from an AIVDO sentence, or when its MMSI is one the
 * caller names in `ownMmsi`. Nothing else removes a target.
 *
 * There was once a fallback here that dropped anything within 0.03 NM as a
 * presumed own-ship echo. It is gone, and must not come back: the nearest
 * vessel is the one an anchor watch exists to warn about, and a rule that
 * silently hides whatever comes closest defeats the alarm at exactly the moment
 * it matters. A boat anchoring 50 m away is not an echo. When identity is
 * genuinely unknown the right outcome is a spurious extra target the skipper
 * can see and dismiss, not a real one nobody is told about.
 *
 * `ownMmsi` accepts several identities so a caller can offer everything it
 * knows at once — configured, from the vessel profile, and learned from AIVDO.
 */
export function getUpdatedAisTargets(
  currentTargetsMap: Map<string, any>,
  ownShipLat: number,
  ownShipLon: number,
  ownShipSog = 0,
  ownShipCog = 0,
  ownMmsi?: string | string[] | null
): { targetsList: AisTargetEnriched[]; targetsMap: Map<string, any> } {
  const updatedMap = new Map(currentTargetsMap);

  const ownMmsis = new Set(
    (Array.isArray(ownMmsi) ? ownMmsi : [ownMmsi])
      .map(m => (m === null || m === undefined ? '' : String(m).trim()))
      .filter(m => m.length > 0)
  );

  const now = Date.now();
  const result: AisTargetEnriched[] = [];

  for (const [mmsi, target] of updatedMap.entries()) {
    // Purge targets after 10 minutes of no updates
    if (now - (target.lastSeen || 0) > 600000) {
      updatedMap.delete(mmsi);
      continue;
    }

    // Own ship, by identity: flagged from AIVDO, or an MMSI the caller named.
    if (target.isOwnVessel || ownMmsis.has(String(mmsi).trim())) {
      continue;
    }

    // Skip targets that do not have valid coordinates yet
    if (
      typeof target.lat !== 'number' ||
      typeof target.lon !== 'number' ||
      isNaN(target.lat) ||
      isNaN(target.lon) ||
      (target.lat === 0 && target.lon === 0)
    ) {
      continue;
    }

    const safeSog = typeof target.sog === 'number' && !isNaN(target.sog) ? target.sog : 0;
    const safeCog = typeof target.cog === 'number' && !isNaN(target.cog) ? target.cog : 0;

    const metrics = calculateTargetMetrics(
      ownShipLat,
      ownShipLon,
      ownShipSog,
      ownShipCog,
      target.lat,
      target.lon,
      safeSog,
      safeCog
    );

    const fullTargetObj = {
      ...target,
      name: target.name || `MMSI ${mmsi}`,
      sog: safeSog,
      cog: safeCog,
      id: target.id || `t-${mmsi}`,
      coords: [target.lat, target.lon],
      sogText: `${safeSog.toFixed(1)} kts`,
      cogText: `${Math.round(safeCog).toString().padStart(3, '0')}° T`,
      ...metrics
    };

    result.push(fullTargetObj);
  }

  // Sort targets by proximity (closest range first)
  result.sort((a, b) => a.rangeVal - b.rangeVal);

  return { targetsList: result, targetsMap: updatedMap };
}
