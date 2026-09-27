/**
 * International weather coverage via Open-Meteo.
 *
 * The fleet's weather station was built US-first: NWS grid forecasts, NWS
 * marine zone bulletins, NWS alerts. That is the right source inside US waters
 * — its marine warnings have no free global equivalent — but it returns nothing
 * at all in the Med, the Pacific, or most of the Caribbean, which is where a
 * cruising boat actually spends its winters.
 *
 * This module is the convenience layer that fills in everywhere NWS ends. It
 * reads Open-Meteo, which serves GFS / ECMWF / ICON as clean JSON, so the apps
 * get global forecasts without running a GRIB ingestion pipeline of their own.
 *
 * It lives in a shared package rather than in one app because three consumers
 * need exactly this logic and it drives risk banding a watch acts on: Ocean's
 * server (PC-server mode), Ocean's client (standalone tablets, which have no
 * server to ask), and HarborSentinel, whose weather station is a Basic-tier
 * feature. Duplicating forecast risk thresholds across those is precisely the
 * drift this codebase has cleaned up before.
 *
 * Two design notes worth keeping:
 *
 *   - Coverage is decided BEFORE calling NWS, not after it fails. A boat off
 *     Cannes previously burned two or three doomed api.weather.gov round trips
 *     on every refresh before falling through. `isInsideNwsCoverage` skips
 *     that. The boxes are deliberately generous: guessing "inside" wrongly
 *     costs one failed request and the caller's existing fallback still catches
 *     it, while guessing "outside" wrongly would silently drop NWS marine
 *     warnings — much the more expensive mistake.
 *
 *   - Wave data comes from Open-Meteo's separate marine endpoint and is treated
 *     as enrichment, never a dependency: if it is slow, blocked, or shaped
 *     differently than expected, the forecast still returns with wind, pressure
 *     and temperature intact.
 *
 *   - The alerts probe reports whether it ran. Warnings are the one part of a
 *     forecast a watch acts on immediately, and an empty `alerts` array used to
 *     mean either "NWS says nothing is in force" or "we never got an answer" —
 *     the second dressed as the first, which is a false all-clear. `alerts`
 *     still comes back empty on failure, because every consumer reads it that
 *     way, but `alertsStatus` alongside it says which of the two happened.
 */
export interface ForecastPeriod {
    periodName: string;
    startTime: string | null;
    endTime: string | null;
    windRange: string;
    windDirection: string;
    riskLevel: 'low' | 'moderate' | 'high';
    reason: string;
    tempRange: string;
    precipChance: string;
    /** Extra marine detail, carried for future UI without changing ForecastTimeline. */
    gustRange: string | null;
    waveHeight: number | null;
    wavePeriod: number | null;
    pressure: string | null;
}
/**
 * Whether the NWS alerts check actually ran, for a forecast that carries an
 * `alerts` array.
 *
 *   - `'ok'`        — NWS answered. An empty `alerts` is a real all-clear.
 *   - `'unavailable'` — the check was attempted and did not answer (network
 *                     error, timeout, non-OK status, unparseable body). An
 *                     empty `alerts` here means nothing at all, and must never
 *                     be presented as an all-clear.
 *   - `'not-requested'` — no check was attempted, because the caller did not
 *                     ask for one. A caller that knows the position is outside
 *                     NWS coverage leaves `probeNwsAlerts` off and lands here;
 *                     see `isInsideNwsCoverage`.
 */
export type AlertsStatus = 'ok' | 'unavailable' | 'not-requested';
export interface MarineForecast {
    summary: string;
    overallRisk: 'low' | 'moderate' | 'high';
    periods: ForecastPeriod[];
    source: string;
    alerts: any[];
    /**
     * Whether `alerts` is an answer or a silence. Always set by
     * `getOpenMeteoForecast`.
     *
     * Optional only so that a consumer assembling its own `MarineForecast` — as
     * the apps do for `errorNote` — keeps compiling; read it as `'ok'` at your
     * peril, since `undefined` means the producer predates this field and its
     * empty `alerts` carries the old ambiguity.
     */
    alertsStatus?: AlertsStatus;
    marineZone: string | null;
    locName: string;
    synopsis: string;
    provider: 'open-meteo';
    /**
     * Marks the forecast as coming from the global model rather than NWS, which
     * HarborSentinel's panel surfaces as an "outside NOAA coverage" note.
     */
    isFallback: true;
    /**
     * Why the primary source was not used, when the caller knows. Set by the app
     * after a failed NWS attempt so the panel can explain itself.
     */
    errorNote?: string;
}
export interface ForecastOptions {
    /**
     * Also probe NWS alerts. For positions inside US coverage where only the grid
     * forecast failed — the warnings may still be live and are worth one request.
     *
     * Worth doing even well outside the grid forecast area: a vessel can sit
     * outside the gridpoint forecast while remaining inside a zone that carries
     * active warnings.
     *
     * Whether the probe got an answer is reported as `alertsStatus` on the
     * result; leaving this off reports `'not-requested'`.
     */
    probeNwsAlerts?: boolean;
    /** Contact string NWS asks API clients to identify themselves with. */
    nwsUserAgent?: string;
    /**
     * Units must match what the consuming app's NWS path emits, or the forecast
     * silently changes meaning as a vessel crosses the coverage boundary.
     * OceanSentinel emits °C; HarborSentinel emits °F.
     */
    temperatureUnit?: 'celsius' | 'fahrenheit';
    /**
     * How to express precipitation. 'probability' reports the chance of rain as a
     * percentage, matching the NWS path; 'accumulation' reports total millimetres.
     */
    precipitation?: 'accumulation' | 'probability';
}
/** True when NWS is expected to have a forecast, so it stays authoritative. */
export declare function isInsideNwsCoverage(lat: number, lon: number): boolean;
/**
 * Hemisphere-correct position label.
 *
 * The previous fallback formatted every position as "N, W", so a boat off Nice
 * was labelled 43.50N, 7.10W — a point in the Atlantic — and everything in the
 * southern hemisphere read as negative north. Exactly the users this layer
 * exists to serve saw the wrong coordinates.
 */
export declare function formatPosition(lat: number, lon: number): string;
/**
 * A global marine forecast for a position, shaped exactly like the NWS path's
 * return value so the UI cannot tell which source answered.
 */
export declare function getOpenMeteoForecast(lat: number, lon: number, options?: ForecastOptions): Promise<MarineForecast>;
/** Test seam: drop memoised forecasts. */
export declare function clearForecastCache(): void;
