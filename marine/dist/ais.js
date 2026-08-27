/**
 * AIS (AIVDM/AIVDO) decoding and tactical collision-assessment utilities
 * shared across the Mariner Sentinel fleet.
 */
// Multi-sentence AIVDM buffer store (indexed by sequence ID)
const aivdmBuffers = new Map();
/** 6-bit ASCII armoring lookup for AIVDM payloads. */
function charTo6Bit(char) {
    let code = char.charCodeAt(0) - 48;
    if (code > 40)
        code -= 8;
    return code & 0x3f;
}
/** Decodes 6-bit armored ASCII string to a binary bit array. */
function decode6BitPayload(payload) {
    const bits = [];
    for (let i = 0; i < payload.length; i++) {
        const val = charTo6Bit(payload[i]);
        for (let b = 5; b >= 0; b--) {
            bits.push((val >> b) & 1);
        }
    }
    return bits;
}
/** Extract integer from a bit slice. */
function getBitsInt(bits, start, length, signed = false) {
    if (start + length > bits.length)
        return 0;
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
function getBitsText(bits, start, length) {
    let text = '';
    const numChars = Math.floor(length / 6);
    for (let i = 0; i < numChars; i++) {
        const code = getBitsInt(bits, start + i * 6, 6, false);
        if (code === 0)
            break; // End of string (@)
        if (code >= 1 && code <= 31) {
            text += String.fromCharCode(code + 64);
        }
        else if (code >= 32 && code <= 63) {
            text += String.fromCharCode(code);
        }
    }
    return text.trim();
}
/** Parses raw NMEA AIVDM / AIVDO sentences into AIS target data. */
export function parseAisSentence(sentence) {
    if (!sentence || (!sentence.startsWith('!') && !sentence.startsWith('$')))
        return null;
    const starIdx = sentence.indexOf('*');
    const payload = starIdx >= 0 ? sentence.substring(0, starIdx) : sentence;
    const parts = payload.split(',');
    if (parts.length < 6)
        return null;
    const talker = parts[0].substring(1);
    if (talker !== 'AIVDM' && talker !== 'AIVDO')
        return null;
    const totalNum = parseInt(parts[1], 10);
    const seqNum = parseInt(parts[2], 10);
    const seqId = parts[3] || '0';
    const armPayload = parts[5];
    let fullPayload = armPayload;
    if (totalNum > 1) {
        const key = `${talker}_${seqId}_${totalNum}`;
        const buf = aivdmBuffers.get(key) || [];
        buf[seqNum - 1] = armPayload;
        aivdmBuffers.set(key, buf);
        if (buf.filter(Boolean).length === totalNum) {
            fullPayload = buf.join('');
            aivdmBuffers.delete(key);
        }
        else {
            return null; // Wait for remaining fragments
        }
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
            }
            else if (partNum === 1) {
                const callSign = getBitsText(bits, 90, 42);
                return { mmsi, callSign: callSign || '---', isOwnVessel, lastSeen: Date.now() };
            }
        }
    }
    catch (err) {
        // Decoding error fallback
    }
    return null;
}
/** Calculates CPA, TCPA, Range, Bearing, and Threat Level between Own Ship and Target. */
export function calculateTargetMetrics(ownLat, ownLon, ownSog = 0, ownCog = 0, tgtLat, tgtLon, tgtSog = 0, tgtCog = 0) {
    const safeTgtSog = typeof tgtSog === 'number' && !isNaN(tgtSog) ? tgtSog : 0;
    const safeTgtCog = typeof tgtCog === 'number' && !isNaN(tgtCog) ? tgtCog : 0;
    const safeOwnSog = typeof ownSog === 'number' && !isNaN(ownSog) ? ownSog : 0;
    const safeOwnCog = typeof ownCog === 'number' && !isNaN(ownCog) ? ownCog : 0;
    if (typeof ownLat !== 'number' ||
        typeof ownLon !== 'number' ||
        typeof tgtLat !== 'number' ||
        typeof tgtLon !== 'number' ||
        isNaN(ownLat) ||
        isNaN(ownLon) ||
        isNaN(tgtLat) ||
        isNaN(tgtLon)) {
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
    if (bearingDeg < 0)
        bearingDeg += 360;
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
        }
        else {
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
    }
    else {
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
/** Generates or updates the target list, recalculating relative motion against own ship. */
export function getUpdatedAisTargets(currentTargetsMap, ownShipLat, ownShipLon, ownShipSog = 0, ownShipCog = 0, ownMmsi, options) {
    const updatedMap = new Map(currentTargetsMap);
    const now = Date.now();
    const result = [];
    for (const [mmsi, target] of updatedMap.entries()) {
        // Purge targets after 10 minutes of no updates
        if (now - (target.lastSeen || 0) > 600000) {
            updatedMap.delete(mmsi);
            continue;
        }
        // Do not show vessel's own AIS target (from AIVDO or matching configured own MMSI)
        const isOwnMmsi = ownMmsi && String(mmsi).trim() === String(ownMmsi).trim();
        if (target.isOwnVessel || isOwnMmsi) {
            continue;
        }
        // Skip targets that do not have valid coordinates yet
        if (typeof target.lat !== 'number' ||
            typeof target.lon !== 'number' ||
            isNaN(target.lat) ||
            isNaN(target.lon) ||
            (target.lat === 0 && target.lon === 0)) {
            continue;
        }
        // Proximity-based own vessel suppression: if a target is within ~55 meters
        // (0.03 NM) of own GPS position, it's almost certainly the vessel's own
        // AIS transponder being rebroadcast as AIVDM by the NMEA multiplexer.
        //
        // This is a fallback for not knowing which MMSI is ours. When the caller
        // supplies ownMmsi, the exact check above has already removed own ship, and
        // keeping this radius would only blind the caller to genuine close-quarters
        // targets — a boat anchoring 50 m away is exactly what a proximity alarm is
        // for. It is skipped entirely for receive-only vessels, which cannot echo
        // themselves. Callers that pass neither keep the old behaviour unchanged.
        const ownShipTransmits = options?.ownShipTransmits !== false;
        if (!ownMmsi && ownShipTransmits) {
            const dLatNM = (target.lat - ownShipLat) * 60;
            const dLonNM = (target.lon - ownShipLon) * 60 * Math.cos(((ownShipLat + target.lat) / 2) * Math.PI / 180);
            const proximityNM = Math.sqrt(dLatNM * dLatNM + dLonNM * dLonNM);
            if (proximityNM < 0.03) {
                continue;
            }
        }
        const safeSog = typeof target.sog === 'number' && !isNaN(target.sog) ? target.sog : 0;
        const safeCog = typeof target.cog === 'number' && !isNaN(target.cog) ? target.cog : 0;
        const metrics = calculateTargetMetrics(ownShipLat, ownShipLon, ownShipSog, ownShipCog, target.lat, target.lon, safeSog, safeCog);
        const fullTargetObj = {
            ...target,
            name: target.name || `MMSI ${mmsi}`,
            sog: safeSog,
            cog: safeCog,
            id: target.id || `t-${mmsi}`,
            coords: [target.lat, target.lon],
            speed: `${safeSog.toFixed(1)} kts`,
            heading: `${Math.round(safeCog).toString().padStart(3, '0')}° M`,
            ...metrics
        };
        result.push(fullTargetObj);
    }
    // Sort targets by proximity (closest range first)
    result.sort((a, b) => a.rangeVal - b.rangeVal);
    return { targetsList: result, targetsMap: updatedMap };
}
