"use strict";
/**
 * NMEA 0183 sentence parsing shared across the Mariner Sentinel fleet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIND_TRUE_HOLD_MS = exports.DEPTH_DATUM_HOLD_MS = exports.FIX_MAX_AGE_MS = exports.ownVesselMmsi = exports.liveAisTargetsMap = void 0;
exports.isFixFresh = isFixFresh;
exports.createNmeaLiveData = createNmeaLiveData;
exports.validateNmeaChecksum = validateNmeaChecksum;
exports.parseNmeaLatitude = parseNmeaLatitude;
exports.parseNmeaLongitude = parseNmeaLongitude;
exports.formatCoords = formatCoords;
exports.isLiveFixMode = isLiveFixMode;
exports.isLiveFixQuality = isLiveFixQuality;
exports.resolveTrueHeading = resolveTrueHeading;
exports.createDepthState = createDepthState;
exports.resolveDepth = resolveDepth;
exports.parseNmeaSentence = parseNmeaSentence;
exports.handleNmeaSentence = handleNmeaSentence;
const ais_js_1 = require("./ais.js");
exports.liveAisTargetsMap = new Map();
/** Auto-detected own vessel MMSI (latched from AIVDO sentences). */
exports.ownVesselMmsi = null;
/**
 * How old a fix may be and still count as live, in milliseconds.
 *
 * Craig's call, 2026-09-27: a fix older than ten seconds is not a live fix, and
 * a position-lost alarm fires after ten seconds without one. A gateway at 1 Hz
 * has missed ten fixes by then, so this is not tight.
 */
exports.FIX_MAX_AGE_MS = 10000;
/**
 * Whether a fix taken at `lastFixAt` is still live.
 *
 * Pure, and takes `now` so the alarm's tests do not depend on the clock. Never
 * having had a fix is not freshness: null and undefined are both false, so a
 * caller cannot get a live answer out of a feed that has produced nothing.
 */
function isFixFresh(lastFixAt, now = Date.now(), maxAgeMs = exports.FIX_MAX_AGE_MS) {
    if (lastFixAt === null || lastFixAt === undefined)
        return false;
    return now - lastFixAt <= maxAgeMs;
}
function createNmeaLiveData() {
    return {
        lat: null,
        lon: null,
        w_speed: null,
        w_dir: null,
        depth: null,
        depth_datum: null,
        depth_offset_ft: null,
        depth_state: createDepthState(),
        w_speed_ref: null,
        w_speed_true_at: null,
        mag_var: null,
        sentenceCount: 0,
        lastUpdate: 0,
        lastFixAt: null
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
    // A field that parses but cannot be a latitude is a corrupt sentence that
    // happened to keep its checksum, or a talker with no checksum at all. It
    // must not become a position.
    if (degs < 0 || mins < 0 || mins >= 60)
        return null;
    let lat = degs + mins / 60;
    if (lat > 90)
        return null;
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
    if (degs < 0 || mins < 0 || mins >= 60)
        return null;
    let lon = degs + mins / 60;
    if (lon > 180)
        return null;
    if (upperHemi === 'W')
        lon = -lon;
    return lon;
}
/** Formats coordinates to a display string, e.g. "N 41° 18.660'". */
function formatCoords(lat, lng) {
    const formatComponent = (val, isLat) => {
        const card = val >= 0 ? (isLat ? 'N' : 'E') : isLat ? 'S' : 'W';
        const absVal = Math.abs(val);
        let deg = Math.floor(absVal);
        let min = (absVal - deg) * 60;
        // 59.9996 minutes prints as "60.000" at three places. Carry it into the
        // degrees, as a position written by hand would.
        if (Number(min.toFixed(3)) >= 60) {
            deg += 1;
            min = 0;
        }
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
const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const FATHOM_TO_M = 1.8288;
/** A numeric field, or undefined when it is empty or not a number. */
function numberField(field) {
    if (field === undefined)
        return undefined;
    const text = field.trim();
    if (!text)
        return undefined;
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? value : undefined;
}
/** An angle folded into 0 to 360. */
function normalizeDegrees(value) {
    const folded = value % 360;
    return folded < 0 ? folded + 360 : folded;
}
/** A value and its E/W flag as a signed number, east positive. */
function signedEastWest(value, flag) {
    const magnitude = numberField(value);
    if (magnitude === undefined || !flag)
        return undefined;
    const side = flag.trim().toUpperCase();
    if (side === 'E')
        return magnitude;
    if (side === 'W')
        return -magnitude;
    return undefined;
}
/**
 * Whether a position sentence's mode indicator describes a fix the receiver
 * actually has.
 *
 * NMEA 2.3 added the field to RMC and GLL. E is estimated (dead reckoning), M
 * is typed in by hand and N is no fix: a receiver that has lost its satellites
 * can go on sending status A with mode E, and each of those sentences used to
 * refresh `lastFixAt`, so the position-lost alarm stayed quiet while the
 * receiver extrapolated. S (simulator) is accepted on purpose: a simulated feed
 * is one somebody connected deliberately, to try the app or to test it. An
 * absent field is an older talker and is taken at its status flag.
 */
function isLiveFixMode(mode) {
    if (mode === undefined || mode === null)
        return true;
    const flag = mode.trim().toUpperCase();
    if (!flag)
        return true;
    return flag === 'A' || flag === 'D' || flag === 'F' || flag === 'P' || flag === 'R' || flag === 'S';
}
/**
 * Whether a GGA quality field describes a fix the receiver actually has: 1 GPS,
 * 2 differential, 3 PPS, 4 and 5 RTK, 8 simulator (see `isLiveFixMode`). 0 is no
 * fix, 6 is estimated and 7 is manual; a field that is not a number is not a
 * fix either.
 */
function isLiveFixQuality(quality) {
    if (quality === undefined || quality === null)
        return false;
    const text = quality.trim();
    if (!/^\d+$/.test(text))
        return false;
    const value = Number.parseInt(text, 10);
    return (value >= 1 && value <= 5) || value === 8;
}
/**
 * True heading from whatever a feed supplies: a true heading as it is, or a
 * magnetic heading corrected by the variation (east positive). Undefined when
 * neither can be had. Course over ground is not a heading and is never used
 * here; an app that wants to fall back to it says so in its own code.
 */
function resolveTrueHeading(input) {
    if (typeof input.heading === 'number' && Number.isFinite(input.heading)) {
        return normalizeDegrees(input.heading);
    }
    if (typeof input.headingMagnetic === 'number' && Number.isFinite(input.headingMagnetic) &&
        typeof input.magVar === 'number' && Number.isFinite(input.magVar)) {
        return normalizeDegrees(input.headingMagnetic + input.magVar);
    }
    return undefined;
}
/**
 * How long a better datum holds off a worse one. A sounder that sends DBT, DBK
 * and DBS sends them every cycle, so anything longer than a few cycles keeps
 * one datum on screen; when the better sentence stops, the worse one is taken
 * again after this long.
 */
exports.DEPTH_DATUM_HOLD_MS = 10000;
function createDepthState() {
    return { offsetM: null, datum: null, at: 0 };
}
/*
  Surface first: it is the depth of water. Keel next, because a draught turns it
  into depth of water, which nothing does for a bare transducer reading.
*/
const DATUM_RANK = { surface: 3, keel: 2, transducer: 1 };
/**
 * One depth, on one datum, from a stream of depth sentences.
 *
 * DBT measures from the transducer, DBK from the keel and DBS from the surface,
 * and DPT measures from the transducer and says how to move the reading: a
 * positive offset to the waterline, a negative one to the keel. A sounder that
 * sends more than one of them used to make the depth jump between datums on
 * every cycle, and a keel offset was added as if it were a waterline offset and
 * the result called depth of water.
 *
 * Call it with every parsed sentence. It returns a reading when the sentence
 * carried a depth on the best datum the feed is currently supplying, and null
 * otherwise, so the caller keeps what it had.
 */
function resolveDepth(state, parsed, now = Date.now()) {
    if (!parsed)
        return null;
    if (typeof parsed.transducerOffset === 'number' && Number.isFinite(parsed.transducerOffset)) {
        state.offsetM = parsed.transducerOffset;
    }
    let candidate = null;
    if (typeof parsed.depthBelowSurface === 'number') {
        candidate = { depthM: parsed.depthBelowSurface, datum: 'surface' };
    }
    else if (typeof parsed.depthBelowKeel === 'number') {
        candidate = { depthM: parsed.depthBelowKeel, datum: 'keel' };
    }
    else if (typeof parsed.depthBelowTransducer === 'number') {
        const offset = state.offsetM;
        if (offset !== null && offset > 0) {
            candidate = { depthM: parsed.depthBelowTransducer + offset, datum: 'surface' };
        }
        else if (offset !== null && offset < 0) {
            candidate = { depthM: parsed.depthBelowTransducer + offset, datum: 'keel' };
        }
        else {
            candidate = { depthM: parsed.depthBelowTransducer, datum: 'transducer' };
        }
    }
    if (!candidate || !Number.isFinite(candidate.depthM))
        return null;
    const held = state.datum !== null && now - state.at <= exports.DEPTH_DATUM_HOLD_MS;
    if (held && DATUM_RANK[candidate.datum] < DATUM_RANK[state.datum])
        return null;
    state.datum = candidate.datum;
    state.at = now;
    return candidate;
}
/**
 * How long a true wind speed holds off an apparent one in `w_speed`. See
 * `NmeaLiveData.w_speed_ref`.
 */
exports.WIND_TRUE_HOLD_MS = 10000;
/**
 * Parses a single NMEA sentence and returns an object of parsed telemetry fields.
 *
 * A field the sentence left empty is ABSENT from the result, never present as
 * `undefined`. Callers merge these objects into what they already hold, and a
 * key that is present overwrites: RMC used to return `magVar: undefined` and
 * erase the variation HDG had supplied a moment earlier.
 */
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
        // Field 12 is the mode indicator, where the talker sends one.
        if (!isLiveFixMode(parts[12]))
            return null;
        const formatted = formatCoords(lat, lon);
        const result = {
            latitude: formatted.latStr,
            longitude: formatted.lngStr,
            latDec: lat,
            lonDec: lon
        };
        const sog = numberField(parts[7]);
        const cog = numberField(parts[8]);
        const magVar = signedEastWest(parts[10], parts[11]);
        if (sog !== undefined)
            result.sog = sog;
        // Course over ground is where the boat is going, not where it points. It
        // used to be returned as `heading` too, so a heading alarm watched GPS
        // course noise and a compass reading was overwritten once a second.
        if (cog !== undefined)
            result.cog = cog;
        if (magVar !== undefined)
            result.magVar = magVar;
        return result;
    }
    if (type === 'GGA') {
        if (!isLiveFixQuality(parts[6]))
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
        if (!isLiveFixMode(parts[7]))
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
    /**
     * The depth sentences. DBT measures from the transducer, DBK from the keel
     * and DBS from the surface; DPT measures from the transducer and carries an
     * offset. Each is returned on its own datum, in metres, and `resolveDepth`
     * turns the stream into one depth on one datum.
     *
     * `waterDepth` is kept on every one of them, with the value it always had,
     * for callers that have not moved to `resolveDepth` yet. It is NOT reliably
     * the depth of water: read the field that names its datum.
     */
    if (type === 'DBT' || type === 'DBK' || type === 'DBS') {
        // Feet, metres, fathoms: whichever the talker filled in.
        const feet = numberField(parts[1]);
        const metresField = numberField(parts[3]);
        const fathoms = numberField(parts[5]);
        const metres = feet !== undefined ? feet * FT_TO_M
            : metresField !== undefined ? metresField
                : fathoms !== undefined ? fathoms * FATHOM_TO_M
                    : undefined;
        if (metres !== undefined) {
            if (type === 'DBT') {
                return {
                    depthBelowTransducer: metres,
                    depthBelowTransducerFeet: feet !== undefined ? feet : metres * M_TO_FT,
                    waterDepth: metres
                };
            }
            return type === 'DBK'
                ? { depthBelowKeel: metres, waterDepth: metres }
                : { depthBelowSurface: metres, waterDepth: metres };
        }
    }
    if (type === 'DPT') {
        const metres = numberField(parts[1]);
        if (metres !== undefined) {
            // Field 2 is the offset from the transducer: positive is the distance up
            // to the waterline, negative the distance down to the keel. It is passed
            // on signed, and `resolveDepth` applies it; it is no longer added here
            // and the sum called depth of water, which a keel offset made untrue.
            const offset = numberField(parts[2]);
            const result = {
                depthBelowTransducer: metres,
                waterDepth: metres + (offset ?? 0)
            };
            if (offset !== undefined)
                result.transducerOffset = offset;
            return result;
        }
    }
    /**
     * VHW: water speed and heading. Field 1 is the heading in degrees true and
     * field 3 the same in degrees magnetic; a talker may fill in either or both.
     * They are returned as what they are. The magnetic one used to be returned
     * as `heading`, where it alternated with RMC's course over ground.
     */
    if (type === 'VHW') {
        const result = {};
        const headingTrue = numberField(parts[1]);
        const headingMagnetic = numberField(parts[3]);
        const knots = numberField(parts[5]);
        const kmh = numberField(parts[7]);
        if (headingTrue !== undefined)
            result.heading = normalizeDegrees(headingTrue);
        if (headingMagnetic !== undefined)
            result.headingMagnetic = normalizeDegrees(headingMagnetic);
        if (knots !== undefined)
            result.stw = knots;
        else if (kmh !== undefined)
            result.stw = kmh * 0.539957;
        return Object.keys(result).length > 0 ? result : null;
    }
    /** HDT: heading in degrees true, from a gyro or satellite compass. */
    if (type === 'HDT') {
        const heading = numberField(parts[1]);
        return heading !== undefined ? { heading: normalizeDegrees(heading) } : null;
    }
    /**
     * THS: true heading with a mode. A is autonomous and S a simulator; E
     * (estimated), M (manual) and V (not valid) are not a compass reading.
     */
    if (type === 'THS') {
        const heading = numberField(parts[1]);
        const mode = parts[2] ? parts[2].trim().toUpperCase() : '';
        if (heading === undefined || (mode && mode !== 'A' && mode !== 'S'))
            return null;
        return { heading: normalizeDegrees(heading) };
    }
    /**
     * RPM: engine or shaft revolutions. `$--RPM,E,1,1850.0,,A` is engine 1 at
     * 1850 rpm; the source is E (engine) or S (shaft) and the status A is valid.
     *
     * Parsed because nothing else in the fleet says whether a boat is under
     * engine, and polar learning needs to know: without it every hour motoring
     * is recorded as sailing performance. A shaft turning is as good a sign as
     * an engine running, so both are reported as `engineRpm`.
     */
    if (type === 'RPM') {
        const source = parts[1] ? parts[1].trim().toUpperCase() : '';
        const rpm = numberField(parts[3]);
        const status = parts[5] ? parts[5].trim().toUpperCase() : '';
        if (rpm === undefined || (status && status !== 'A'))
            return null;
        if (source && source !== 'E' && source !== 'S')
            return null;
        const engineNumber = numberField(parts[2]);
        return {
            engineRpm: Math.abs(rpm),
            ...(engineNumber !== undefined ? { engineNumber } : {}),
        };
    }
    /** HDM: heading in degrees magnetic. */
    if (type === 'HDM') {
        const heading = numberField(parts[1]);
        return heading !== undefined ? { headingMagnetic: normalizeDegrees(heading) } : null;
    }
    /**
     * HDG: the magnetic sensor's heading, its deviation and the local variation.
     * Heading magnetic is the sensor reading plus the deviation (east positive);
     * true is that plus the variation, when the talker supplies one. Only the
     * variation used to be read, and the heading itself thrown away.
     */
    if (type === 'HDG') {
        const result = {};
        const sensor = numberField(parts[1]);
        const deviation = signedEastWest(parts[2], parts[3]);
        const variation = signedEastWest(parts[4], parts[5]);
        if (sensor !== undefined) {
            const magnetic = sensor + (deviation ?? 0);
            result.headingMagnetic = normalizeDegrees(magnetic);
            if (variation !== undefined)
                result.heading = normalizeDegrees(magnetic + variation);
        }
        if (variation !== undefined)
            result.magVar = variation;
        return Object.keys(result).length > 0 ? result : null;
    }
    if (type === 'MWD') {
        // Field 1 is the direction the wind blows FROM relative to true north,
        // field 3 the same relative to magnetic north, field 5 the speed in knots
        // and field 7 in metres a second. MWD is the TRUE wind: it used to be
        // written into the apparent fields as well, and a magnetic direction was
        // returned as a true one when the true field was empty.
        const result = {};
        const directionTrue = numberField(parts[1]);
        const directionMagnetic = numberField(parts[3]);
        const knots = numberField(parts[5]);
        const metresPerSecond = numberField(parts[7]);
        if (directionTrue !== undefined)
            result.twd = normalizeDegrees(directionTrue);
        if (directionMagnetic !== undefined)
            result.twdMagnetic = normalizeDegrees(directionMagnetic);
        if (knots !== undefined)
            result.tws = knots;
        else if (metresPerSecond !== undefined)
            result.tws = metresPerSecond * 1.94384;
        return Object.keys(result).length > 0 ? result : null;
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
        // Only whether the angle is usable matters: `awa` is built from the raw
        // field, so a computed 0-360 bearing here would go unused.
        const hasAngle = Boolean(angleStr && lr) && !isNaN(parseFloat(angleStr));
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
        if (hasAngle && speed !== null) {
            // VWR is a bow-relative angle too, so like MWV it sets no direction.
            return {
                awa: angleStr + (lr === 'L' ? '° PORT' : '° STBD'),
                aws: speed
            };
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
        // Only here: see the note on `lastFixAt`. A sentence that carried no
        // position must not make the position look newer than it is.
        liveData.lastFixAt = Date.now();
        updated = true;
    }
    const now = Date.now();
    if (typeof parsed.magVar === 'number')
        liveData.mag_var = parsed.magVar;
    // True wind where the feed has it, apparent otherwise. A feed with both sends
    // them in turn, so the apparent figure is held off while a true one is
    // recent; without that the reading alternated between the two.
    if (parsed.tws !== undefined) {
        liveData.w_speed = parsed.tws;
        liveData.w_speed_ref = 'true';
        liveData.w_speed_true_at = now;
        updated = true;
    }
    else if (parsed.aws !== undefined) {
        const trueAt = liveData.w_speed_true_at;
        const trueIsRecent = typeof trueAt === 'number' && now - trueAt <= exports.WIND_TRUE_HOLD_MS;
        if (!trueIsRecent) {
            liveData.w_speed = parsed.aws;
            liveData.w_speed_ref = 'apparent';
            updated = true;
        }
    }
    // The direction the wind blows from. A magnetic bearing is corrected by the
    // variation when the feed has supplied one; with none it is used as it is,
    // which is out by the local variation and better than no direction at all.
    if (parsed.twd !== undefined) {
        liveData.w_dir = parsed.twd;
        updated = true;
    }
    else if (parsed.twdMagnetic !== undefined) {
        const variation = typeof liveData.mag_var === 'number' ? liveData.mag_var : 0;
        liveData.w_dir = normalizeDegrees(parsed.twdMagnetic + variation);
        updated = true;
    }
    // An object built before `depth_state` existed gets one here.
    const depthState = liveData.depth_state ?? (liveData.depth_state = createDepthState());
    const reading = resolveDepth(depthState, parsed, now);
    if (depthState.offsetM !== null) {
        liveData.depth_offset_ft = depthState.offsetM * M_TO_FT;
    }
    if (reading) {
        liveData.depth = reading.depthM * M_TO_FT;
        liveData.depth_datum = reading.datum;
        updated = true;
    }
    if (updated) {
        liveData.sentenceCount++;
        liveData.lastUpdate = Date.now();
    }
}
