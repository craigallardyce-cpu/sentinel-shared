"use strict";
/**
 * NMEA 0183 sentence parsing shared across the Mariner Sentinel fleet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownVesselMmsi = exports.liveAisTargetsMap = void 0;
exports.createNmeaLiveData = createNmeaLiveData;
exports.validateNmeaChecksum = validateNmeaChecksum;
exports.parseNmeaLatitude = parseNmeaLatitude;
exports.parseNmeaLongitude = parseNmeaLongitude;
exports.formatCoords = formatCoords;
exports.parseNmeaSentence = parseNmeaSentence;
exports.handleNmeaSentence = handleNmeaSentence;
const ais_js_1 = require("./ais.js");
exports.liveAisTargetsMap = new Map();
/** Auto-detected own vessel MMSI (latched from AIVDO sentences). */
exports.ownVesselMmsi = null;
function createNmeaLiveData() {
    return {
        lat: null,
        lon: null,
        w_speed: null,
        w_dir: null,
        depth: null,
        sentenceCount: 0,
        lastUpdate: 0
    };
}
/** Validates NMEA sentence checksum (XOR of all chars between $/! and *). */
function validateNmeaChecksum(sentence) {
    if (!sentence.startsWith('$') && !sentence.startsWith('!')) {
        return false;
    }
    const starIdx = sentence.lastIndexOf('*');
    if (starIdx < 0) {
        return true; // Allow legacy sentences without checksum
    }
    const payload = sentence.substring(1, starIdx);
    const checksumStr = sentence.substring(starIdx + 1);
    const hex = checksumStr.trim().substring(0, 2);
    if (hex.length !== 2) {
        return false;
    }
    const expected = parseInt(hex, 16);
    if (isNaN(expected)) {
        return false;
    }
    let calculated = 0;
    for (let i = 0; i < payload.length; i++) {
        calculated ^= payload.charCodeAt(i);
    }
    return calculated === expected;
}
/** Parses NMEA latitude field (DDMM.MMM format). */
function parseNmeaLatitude(val, hemi) {
    if (!val || !hemi)
        return null;
    val = val.trim();
    const upperHemi = hemi.trim().toUpperCase();
    if (upperHemi !== 'N' && upperHemi !== 'S')
        return null;
    const dot = val.indexOf('.');
    if (dot < 0)
        return null;
    const minStart = Math.max(0, dot - 2);
    const degsStr = val.substring(0, minStart);
    const minsStr = val.substring(minStart);
    const degs = degsStr.length > 0 ? parseFloat(degsStr) : 0;
    const mins = parseFloat(minsStr);
    if (isNaN(degs) || isNaN(mins))
        return null;
    let lat = degs + mins / 60;
    if (upperHemi === 'S')
        lat = -lat;
    return lat;
}
/** Parses NMEA longitude field (DDDMM.MMM format). */
function parseNmeaLongitude(val, hemi) {
    if (!val || !hemi)
        return null;
    val = val.trim();
    const upperHemi = hemi.trim().toUpperCase();
    if (upperHemi !== 'E' && upperHemi !== 'W')
        return null;
    const dot = val.indexOf('.');
    if (dot < 0)
        return null;
    const minStart = Math.max(0, dot - 2);
    const degsStr = val.substring(0, minStart);
    const minsStr = val.substring(minStart);
    const degs = degsStr.length > 0 ? parseFloat(degsStr) : 0;
    const mins = parseFloat(minsStr);
    if (isNaN(degs) || isNaN(mins))
        return null;
    let lon = degs + mins / 60;
    if (upperHemi === 'W')
        lon = -lon;
    return lon;
}
/** Formats coordinates to a display string, e.g. "N 41° 18.660'". */
function formatCoords(lat, lng) {
    const formatComponent = (val, isLat) => {
        const card = val >= 0 ? (isLat ? 'N' : 'E') : isLat ? 'S' : 'W';
        const absVal = Math.abs(val);
        const deg = Math.floor(absVal);
        const min = (absVal - deg) * 60;
        const degStr = deg.toString().padStart(isLat ? 2 : 3, '0');
        const minFixed = min.toFixed(3);
        const [minInt, minDec] = minFixed.split('.');
        const minIntPadded = minInt.padStart(2, '0');
        return `${card} ${degStr}° ${minIntPadded}.${minDec}'`;
    };
    return {
        latStr: formatComponent(lat, true),
        lngStr: formatComponent(lng, false)
    };
}
/** Parses a single NMEA sentence and returns an object of parsed telemetry fields. */
function parseNmeaSentence(sentence) {
    if (!sentence || (!sentence.startsWith('$') && !sentence.startsWith('!')))
        return null;
    if (!validateNmeaChecksum(sentence)) {
        return null;
    }
    if (sentence.includes('AIVDM') || sentence.includes('AIVDO')) {
        const aisData = (0, ais_js_1.parseAisSentence)(sentence);
        if (aisData) {
            return { aisData };
        }
    }
    const starIdx = sentence.indexOf('*');
    const payload = starIdx >= 0 ? sentence.substring(0, starIdx) : sentence;
    const parts = payload.split(',');
    if (parts.length === 0)
        return null;
    const type = parts[0].toUpperCase().slice(3); // e.g. RMC, GGA, DBT, etc.
    if (type === 'RMC') {
        const status = parts[2];
        if (status !== 'A')
            return null;
        const lat = parseNmeaLatitude(parts[3], parts[4]);
        const lon = parseNmeaLongitude(parts[5], parts[6]);
        if (lat === null || lon === null)
            return null;
        const formatted = formatCoords(lat, lon);
        const sogRaw = parts[7];
        const cogRaw = parts[8];
        let magVar = undefined;
        if (parts[10] && parts[11]) {
            magVar = parseFloat(parts[10]);
            if (parts[11] === 'W') {
                magVar = -magVar;
            }
        }
        return {
            latitude: formatted.latStr,
            longitude: formatted.lngStr,
            latDec: lat,
            lonDec: lon,
            sog: sogRaw ? parseFloat(sogRaw) : undefined,
            cog: cogRaw ? parseFloat(cogRaw) : undefined,
            heading: cogRaw ? parseFloat(cogRaw) : undefined,
            magVar: magVar
        };
    }
    if (type === 'GGA') {
        const quality = parseInt(parts[6], 10);
        if (quality === 0)
            return null;
        const lat = parseNmeaLatitude(parts[2], parts[3]);
        const lon = parseNmeaLongitude(parts[4], parts[5]);
        if (lat === null || lon === null)
            return null;
        const formatted = formatCoords(lat, lon);
        return {
            latitude: formatted.latStr,
            longitude: formatted.lngStr,
            latDec: lat,
            lonDec: lon
        };
    }
    if (type === 'GLL') {
        const status = parts[6];
        if (status !== 'A')
            return null;
        const lat = parseNmeaLatitude(parts[1], parts[2]);
        const lon = parseNmeaLongitude(parts[3], parts[4]);
        if (lat === null || lon === null)
            return null;
        const formatted = formatCoords(lat, lon);
        return {
            latitude: formatted.latStr,
            longitude: formatted.lngStr,
            latDec: lat,
            lonDec: lon
        };
    }
    if (type === 'DBT' || type === 'DBK' || type === 'DBS') {
        const feetStr = parts[1];
        const metersStr = parts[3];
        if (feetStr) {
            const feet = parseFloat(feetStr);
            if (!isNaN(feet)) {
                return { waterDepth: feet * 0.3048, depthFeet: feet };
            }
        }
        else if (metersStr) {
            const meters = parseFloat(metersStr);
            if (!isNaN(meters)) {
                return { waterDepth: meters, depthFeet: meters * 3.28084 };
            }
        }
    }
    if (type === 'DPT') {
        const metersStr = parts[1];
        if (metersStr) {
            const meters = parseFloat(metersStr);
            let offset = 0;
            if (parts[2]) {
                const parsedOffset = parseFloat(parts[2]);
                if (!isNaN(parsedOffset)) {
                    offset = parsedOffset;
                }
            }
            if (!isNaN(meters)) {
                const finalDepthMeters = meters + offset;
                return { waterDepth: finalDepthMeters, depthFeet: finalDepthMeters * 3.28084 };
            }
        }
    }
    if (type === 'VHW') {
        const headingMag = parseFloat(parts[3]);
        const speedKnots = parseFloat(parts[5]);
        return {
            heading: !isNaN(headingMag) ? headingMag : undefined,
            stw: !isNaN(speedKnots) ? speedKnots : undefined
        };
    }
    if (type === 'MWD') {
        // Field 1 is the direction the wind blows FROM relative to true north,
        // field 3 the same relative to magnetic north. Prefer true; plenty of
        // instruments populate only one of the two, so fall back rather than
        // reporting a magnetic bearing as a true one.
        const windDirTrue = parseFloat(parts[1]);
        const windDirMag = parseFloat(parts[3]);
        const windDir = !isNaN(windDirTrue) ? windDirTrue : (!isNaN(windDirMag) ? windDirMag : undefined);
        const windSpeedKnots = parseFloat(parts[5]);
        return {
            awd: windDir,
            twd: windDir,
            aws: !isNaN(windSpeedKnots) ? windSpeedKnots : undefined,
            tws: !isNaN(windSpeedKnots) ? windSpeedKnots : undefined
        };
    }
    /**
     * MWV gives a wind ANGLE measured from the bow, for both references: 'R' is
     * apparent, 'T' is the true wind corrected for boat speed but still expressed
     * relative to the vessel. Neither is a compass direction.
     *
     * Writing that angle into awd/twd — which feed `w_dir`, the direction the wind
     * is blowing from — made the reported wind direction flip several times a
     * second on any feed carrying both MWV and MWD, since each sentence
     * overwrote the other with a different quantity. On a boat head to wind the
     * two differ by roughly the vessel's heading.
     */
    if (type === 'MWV') {
        const angle = parseFloat(parts[1]);
        const reference = parts[2] ? parts[2].toUpperCase() : ''; // R = Relative, T = True
        const speed = parseFloat(parts[3]);
        const units = parts[4] ? parts[4].toUpperCase() : '';
        const status = parts[5] ? parts[5].toUpperCase() : '';
        if ((status === 'A' || !status) && !isNaN(angle) && !isNaN(speed)) {
            let speedKnots = speed;
            if (units === 'M') {
                speedKnots = speed * 1.94384;
            }
            else if (units === 'K') {
                speedKnots = speed * 0.539957;
            }
            else if (units === 'S') {
                speedKnots = speed * 0.868976;
            }
            if (reference === 'R') {
                let awaStr = `${angle.toFixed(0)}° STBD`;
                if (angle > 180) {
                    awaStr = `${(360 - angle).toFixed(0)}° PORT`;
                }
                // MWV reports an angle off the bow, not a compass bearing, so it must
                // not populate awd/twd — see the note on the MWV block above.
                return {
                    awa: awaStr,
                    aws: parseFloat(speedKnots.toFixed(1))
                };
            }
            else if (reference === 'T') {
                return {
                    tws: parseFloat(speedKnots.toFixed(1))
                };
            }
        }
    }
    if (type === 'VWR') {
        const angleStr = parts[1];
        const lr = parts[2] ? parts[2].toUpperCase() : '';
        const speedKnotsStr = parts[3];
        const speedMsStr = parts[5];
        let angle = null;
        if (angleStr && lr) {
            const parsed = parseFloat(angleStr);
            if (!isNaN(parsed)) {
                angle = lr === 'L' ? (360 - parsed) % 360 : parsed;
            }
        }
        let speed = null;
        if (speedKnotsStr) {
            const parsed = parseFloat(speedKnotsStr);
            if (!isNaN(parsed))
                speed = parsed;
        }
        else if (speedMsStr) {
            const parsed = parseFloat(speedMsStr);
            if (!isNaN(parsed))
                speed = parsed * 1.94384;
        }
        if (angle !== null && speed !== null) {
            // VWR is a bow-relative angle too, so like MWV it sets no direction.
            return {
                awa: angleStr + (lr === 'L' ? '° PORT' : '° STBD'),
                aws: speed
            };
        }
    }
    if (type === 'HDG') {
        let magVar = undefined;
        if (parts[4] && parts[5]) {
            magVar = parseFloat(parts[4]);
            if (parts[5] === 'W') {
                magVar = -magVar;
            }
            return { magVar: magVar };
        }
    }
    return null;
}
/** Parses an NMEA sentence and updates a shared live-data object in place. */
function handleNmeaSentence(sentence, liveData) {
    const parsed = parseNmeaSentence(sentence);
    if (!parsed)
        return;
    if (parsed.aisData && parsed.aisData.mmsi) {
        // Latch own vessel MMSI from AIVDO sentences (own transponder)
        if (parsed.aisData.isOwnVessel && parsed.aisData.mmsi) {
            exports.ownVesselMmsi = parsed.aisData.mmsi;
        }
        // Mark as own vessel if MMSI matches latched own MMSI
        const isOwn = Boolean(parsed.aisData.isOwnVessel ||
            (exports.ownVesselMmsi && String(parsed.aisData.mmsi).trim() === String(exports.ownVesselMmsi).trim()));
        const existing = exports.liveAisTargetsMap.get(parsed.aisData.mmsi) || {};
        exports.liveAisTargetsMap.set(parsed.aisData.mmsi, {
            ...existing,
            ...parsed.aisData,
            isOwnVessel: isOwn || Boolean(existing.isOwnVessel),
            lastSeen: Date.now()
        });
    }
    let updated = false;
    if (parsed.latDec !== undefined && parsed.lonDec !== undefined) {
        liveData.lat = parsed.latDec;
        liveData.lon = parsed.lonDec;
        updated = true;
    }
    if (parsed.tws !== undefined) {
        liveData.w_speed = parsed.tws;
        updated = true;
    }
    else if (parsed.aws !== undefined) {
        liveData.w_speed = parsed.aws;
        updated = true;
    }
    if (parsed.twd !== undefined) {
        liveData.w_dir = parsed.twd;
        updated = true;
    }
    else if (parsed.awd !== undefined) {
        liveData.w_dir = parsed.awd;
        updated = true;
    }
    if (parsed.depthFeet !== undefined) {
        liveData.depth = parsed.depthFeet;
        updated = true;
    }
    if (updated) {
        liveData.sentenceCount++;
        liveData.lastUpdate = Date.now();
    }
}
