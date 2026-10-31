/**
 * Reading an NWS forecast period without throwing, and its wind in knots.
 *
 * Moved here on 2026-10-31 from the two app-local copies of each helper:
 * HarborSentinel's shared/nwsPeriodTimes.ts and shared/nwsWind.ts (HarborSentinel
 * #89), and OceanSentinel's backend/services/nwsPeriodTimes.js (OceanSentinel #91)
 * and backend/services/nwsWind.js (OceanSentinel #94, a port of HarborSentinel's).
 * Each app's backend and its standalone direct fetch both use them.
 *
 * TIMES. Two shapes of NWS forecast reach the apps. A gridpoint forecast
 * (/gridpoints/.../forecast) gives every period an ISO `startTime` and
 * `endTime`. A marine zone forecast (/zones/forecast/ANZ236/forecast) gives only
 * `number`, `name` ("Tonight", "Tue Night", "Fri through Sat Night") and
 * `detailedForecast`: the text product has no times. Both apps once filled a
 * missing end with `new Date(new Date(undefined).getTime() + 12h).toISOString()`,
 * which throws RangeError "Invalid time value". On a backend that one throw
 * discarded the whole NOAA forecast for every vessel inside a marine zone in
 * favour of Open-Meteo; on a phone's standalone path it showed the error.
 *
 * So a time that is absent or unparseable is null here, and only that field is
 * lost. The period keeps its NWS name. A period with no known end is kept,
 * because NWS reissues the zone text and drops periods that have passed itself.
 *
 * WIND. NWS writes wind in two units. A marine zone forecast says knots ("NW
 * winds 10 to 15 kt with gusts up to 20 kt"); a gridpoint (land) forecast says
 * miles per hour, both in its text ("Northwest wind 17 to 21 mph, with gusts as
 * high as 36 mph") and in its `windSpeed` field ("10 to 15 mph"). A parser that
 * matched either unit and kept the number put a 36 mph gust on the weather card
 * as "36 kt", 15% high, on the figure an anchor watch is judged by. Every number
 * here carries the unit it was written with, and mph is converted (x 0.868976,
 * rounded to a whole knot). Knots pass through unchanged, so a zone forecast is
 * never converted twice.
 */
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
/** A Date for an NWS time string, or null when it is absent or not a time. */
export function parseNwsTime(value) {
    if (typeof value !== 'string' || value === '')
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * `{ startTime, endTime }`, either of which may be null. A time NWS sent that
 * parses is passed through as NWS wrote it (with its offset), so a gridpoint
 * forecast comes out exactly as it did before. A missing end is taken as twelve
 * hours after a known start, as before.
 */
export function nwsPeriodTimes(period) {
    const start = parseNwsTime(period?.startTime);
    const end = parseNwsTime(period?.endTime);
    return {
        startTime: start ? period.startTime : null,
        endTime: end
            ? period.endTime
            : start ? new Date(start.getTime() + TWELVE_HOURS_MS).toISOString() : null,
    };
}
/** False only for a period whose end is known and already past. */
export function nwsPeriodIsCurrent(period, now = new Date()) {
    const end = parseNwsTime(period?.endTime);
    return !end || end > now;
}
export const MPH_TO_KNOTS = 0.868976;
/** 'mph' for any spelling of miles per hour, 'kt' for any spelling of knots, else null. */
export function windUnit(raw) {
    if (!raw)
        return null;
    const u = String(raw).toLowerCase().replace(/\./g, '');
    if (u === 'mph')
        return 'mph';
    if (u === 'kt' || u === 'kts' || u === 'knot' || u === 'knots')
        return 'kt';
    return null;
}
/** A speed in `unit`, as whole knots. */
export function toKnots(value, unit) {
    return unit === 'mph' ? Math.round(value * MPH_TO_KNOTS) : Math.round(value);
}
const UNIT = String.raw `(kt|kts|knots?|mph|m\.p\.h\.)`;
const WIND_RE = new RegExp(String.raw `(?:wind|winds|wind speed)\s*(?:around|of)?\s*(\d+)\s*(?:to\s*(\d+))?\s*` + UNIT, 'i');
const GUST_RE = new RegExp(String.raw `(?:gust|gusts|gusting)\s*(?:as|up|of)?\s*(?:high|to)?\s*(?:as)?\s*(\d+)\s*` + UNIT, 'i');
const FIELD_RE = new RegExp(String.raw `^\s*(\d+)\s*(?:to\s*(\d+))?\s*` + UNIT + String.raw `?\s*$`, 'i');
/**
 * An NWS `windSpeed` field ("10 to 15 mph", "5 mph", "10 kt") as knots. A field
 * with no unit is mph, which is what the gridpoint forecast always uses.
 */
export function parseNwsWindSpeed(field) {
    if (typeof field !== 'string')
        return null;
    const m = field.match(FIELD_RE);
    if (!m)
        return null;
    const unit = windUnit(m[3]) ?? 'mph';
    const a = toKnots(parseInt(m[1], 10), unit);
    const b = m[2] ? toKnots(parseInt(m[2], 10), unit) : a;
    return { min: Math.min(a, b), max: Math.max(a, b) };
}
/**
 * The wind in one NWS period, in knots: from its text, and from its `windSpeed`
 * field when the text names no sustained wind.
 */
export function parseNwsWind(text, windSpeedField) {
    let sustainedMin = null;
    let sustainedMax = null;
    let gust = null;
    const w = text.match(WIND_RE);
    const wUnit = w ? windUnit(w[3]) : null;
    if (w && wUnit) {
        const a = toKnots(parseInt(w[1], 10), wUnit);
        const b = w[2] ? toKnots(parseInt(w[2], 10), wUnit) : a;
        sustainedMin = Math.min(a, b);
        sustainedMax = Math.max(a, b);
    }
    else {
        const field = parseNwsWindSpeed(windSpeedField);
        if (field) {
            sustainedMin = field.min;
            sustainedMax = field.max;
        }
    }
    const g = text.match(GUST_RE);
    const gUnit = g ? windUnit(g[2]) : null;
    if (g && gUnit)
        gust = toKnots(parseInt(g[1], 10), gUnit);
    const max = Math.max(0, sustainedMax ?? 0, gust ?? 0);
    return { sustainedMin, sustainedMax, gust, max };
}
