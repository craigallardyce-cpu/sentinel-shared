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
/** A Date for an NWS time string, or null when it is absent or not a time. */
export declare function parseNwsTime(value: unknown): Date | null;
export interface NwsPeriodTimes {
    startTime: string | null;
    endTime: string | null;
}
/**
 * `{ startTime, endTime }`, either of which may be null. A time NWS sent that
 * parses is passed through as NWS wrote it (with its offset), so a gridpoint
 * forecast comes out exactly as it did before. A missing end is taken as twelve
 * hours after a known start, as before.
 */
export declare function nwsPeriodTimes(period: {
    startTime?: unknown;
    endTime?: unknown;
} | null | undefined): NwsPeriodTimes;
/** False only for a period whose end is known and already past. */
export declare function nwsPeriodIsCurrent(period: {
    endTime?: unknown;
} | null | undefined, now?: Date): boolean;
export declare const MPH_TO_KNOTS = 0.868976;
export type WindUnit = 'kt' | 'mph';
/** 'mph' for any spelling of miles per hour, 'kt' for any spelling of knots, else null. */
export declare function windUnit(raw: string | undefined | null): WindUnit | null;
/** A speed in `unit`, as whole knots. */
export declare function toKnots(value: number, unit: WindUnit): number;
export interface NwsWind {
    /** Lowest sustained speed in knots, or null when none was given. */
    sustainedMin: number | null;
    /** Highest sustained speed in knots, or null when none was given. */
    sustainedMax: number | null;
    /** Gust in knots, or null. */
    gust: number | null;
    /** The largest of the above (what the card shows), or 0 when there is none. */
    max: number;
}
/**
 * An NWS `windSpeed` field ("10 to 15 mph", "5 mph", "10 kt") as knots. A field
 * with no unit is mph, which is what the gridpoint forecast always uses.
 */
export declare function parseNwsWindSpeed(field: unknown): {
    min: number;
    max: number;
} | null;
/**
 * The wind in one NWS period, in knots: from its text, and from its `windSpeed`
 * field when the text names no sustained wind.
 */
export declare function parseNwsWind(text: string, windSpeedField?: unknown): NwsWind;
