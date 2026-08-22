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
 */
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
/** Forecasts refresh hourly upstream; this keeps us a good citizen of a free API. */
const CACHE_TTL_MS = 20 * 60 * 1000;
const FORECAST_TIMEOUT_MS = 8000;
const MARINE_TIMEOUT_MS = 5000;
const PERIOD_HOURS = 12;
const PERIOD_COUNT = 6;
/**
 * Where NWS has data, drawn generously to include offshore approaches.
 * [minLat, maxLat, minLon, maxLon]
 */
const NWS_COVERAGE_BOXES = [
    [18, 55, -130, -58], // CONUS with Atlantic, Gulf and Pacific approaches
    [48, 75, -180, -128], // Alaska
    [15, 30, -166, -150], // Hawaii
    [15, 21, -69, -63], // Puerto Rico / USVI
    [11, 22, 141, 150], // Guam / CNMI
    [-18, -10, -173, -168] // American Samoa
];
/** True when NWS is expected to have a forecast, so it stays authoritative. */
export function isInsideNwsCoverage(lat, lon) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum))
        return false;
    return NWS_COVERAGE_BOXES.some(([minLat, maxLat, minLon, maxLon]) => latNum >= minLat && latNum <= maxLat && lonNum >= minLon && lonNum <= maxLon);
}
/**
 * Hemisphere-correct position label.
 *
 * The previous fallback formatted every position as "N, W", so a boat off Nice
 * was labelled 43.50N, 7.10W — a point in the Atlantic — and everything in the
 * southern hemisphere read as negative north. Exactly the users this layer
 * exists to serve saw the wrong coordinates.
 */
export function formatPosition(lat, lon) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum))
        return 'Unknown position';
    const latHemi = latNum >= 0 ? 'N' : 'S';
    const lonHemi = lonNum >= 0 ? 'E' : 'W';
    return `${Math.abs(latNum).toFixed(2)}°${latHemi} ${Math.abs(lonNum).toFixed(2)}°${lonHemi}`;
}
/**
 * Open-Meteo returns ISO strings with no zone suffix and defaults to GMT, so
 * `new Date(value)` reads them as local time — a silent offset on any machine
 * not set to UTC. Parse them as UTC explicitly.
 */
function parseUtc(value) {
    if (typeof value !== 'string')
        return null;
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
    const parsed = new Date(withZone);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const COMPASS_16 = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];
/**
 * Circular mean of wind directions.
 *
 * Averaging degrees arithmetically breaks across north: 350° and 10° average to
 * 180°, reporting a southerly when the wind is northerly. Averaging the unit
 * vectors is the only correct way, and wind direction is not a detail to get
 * backwards on a boat.
 */
function meanDirection(degrees) {
    const valid = degrees.filter((d) => Number.isFinite(d));
    if (!valid.length)
        return null;
    let sumSin = 0;
    let sumCos = 0;
    for (const deg of valid) {
        const rad = (deg * Math.PI) / 180;
        sumSin += Math.sin(rad);
        sumCos += Math.cos(rad);
    }
    if (Math.abs(sumSin) < 1e-9 && Math.abs(sumCos) < 1e-9)
        return null;
    return ((Math.atan2(sumSin, sumCos) * 180) / Math.PI + 360) % 360;
}
function compassPoint(degrees) {
    if (degrees === null)
        return 'Variable';
    return COMPASS_16[Math.round(degrees / 22.5) % 16];
}
const finiteOnly = (values) => values.filter((v) => Number.isFinite(v));
const maxOf = (values) => {
    const valid = finiteOnly(values);
    return valid.length ? Math.max(...valid) : null;
};
const meanOf = (values) => {
    const valid = finiteOnly(values);
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
};
/**
 * Worst of the wind, gust and sea signals.
 *
 * Sustained thresholds match what the NWS path already uses, so a boat does not
 * see the risk band jump as it crosses into international waters. Gusts are
 * banded on Beaufort: 34 kt is gale force, 22 kt near the top of a strong
 * breeze. Seas are included because offshore they are often why a passage turns
 * unpleasant well before the sustained wind says so.
 */
function assessRisk(input) {
    let risk = 'low';
    const raise = (level) => {
        if (level === 'high')
            risk = 'high';
        else if (risk !== 'high')
            risk = 'moderate';
    };
    const { sustainedKts, gustKts, waveMetres } = input;
    if (sustainedKts !== null) {
        if (sustainedKts > 25)
            raise('high');
        else if (sustainedKts > 15)
            raise('moderate');
    }
    if (gustKts !== null) {
        if (gustKts > 34)
            raise('high');
        else if (gustKts > 22)
            raise('moderate');
    }
    if (waveMetres !== null) {
        if (waveMetres > 4)
            raise('high');
        else if (waveMetres > 2.5)
            raise('moderate');
    }
    return risk;
}
function describePressureTrend(pressures) {
    const valid = finiteOnly(pressures);
    if (valid.length < 2)
        return null;
    const change = valid[valid.length - 1] - valid[0];
    const hPa = Math.round(valid[valid.length - 1]);
    if (change <= -3)
        return `${hPa} hPa falling`;
    if (change >= 3)
        return `${hPa} hPa rising`;
    return `${hPa} hPa steady`;
}
async function fetchJson(url, timeoutMs) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
        throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
    }
    return res.json();
}
/**
 * Wave height and period, or null. Enrichment only — every failure path here is
 * swallowed so a slow or unavailable marine endpoint cannot cost the boat its
 * wind forecast.
 */
async function fetchMarineHourly(lat, lon) {
    try {
        const url = `${MARINE_URL}?latitude=${lat}&longitude=${lon}` +
            `&hourly=wave_height,wave_period,wave_direction&forecast_days=3`;
        const data = await fetchJson(url, MARINE_TIMEOUT_MS);
        const hourly = data?.hourly;
        if (!hourly || !Array.isArray(hourly.time))
            return null;
        return {
            time: hourly.time,
            waveHeight: Array.isArray(hourly.wave_height) ? hourly.wave_height : [],
            wavePeriod: Array.isArray(hourly.wave_period) ? hourly.wave_period : [],
            waveDirection: Array.isArray(hourly.wave_direction) ? hourly.wave_direction : []
        };
    }
    catch (err) {
        // Inland positions legitimately have no marine grid, so this happens often
        // enough that it is not worth raising to a warning.
        console.log(`[Weather] Marine wave enrichment unavailable: ${err?.message ?? err}`);
        return null;
    }
}
const cache = new Map();
const cacheKey = (lat, lon) => `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
/** Active NWS alerts for a point; empty on any failure. */
async function fetchNwsAlerts(lat, lon, userAgent) {
    try {
        const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {
            headers: { 'User-Agent': userAgent },
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        return (data.features || []).map((f) => ({
            event: f.properties.event,
            headline: f.properties.headline,
            description: f.properties.description,
            severity: f.properties.severity,
            urgency: f.properties.urgency,
            instruction: f.properties.instruction,
            effective: f.properties.effective,
            ends: f.properties.ends || f.properties.expires,
            distance: 0
        }));
    }
    catch {
        return [];
    }
}
/**
 * A global marine forecast for a position, shaped exactly like the NWS path's
 * return value so the UI cannot tell which source answered.
 */
export async function getOpenMeteoForecast(lat, lon, options = {}) {
    const { probeNwsAlerts = false, nwsUserAgent = '(mariner-sentinel)' } = options;
    const key = cacheKey(lat, lon);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.value;
    }
    const forecastUrl = `${FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
        '&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,pressure_msl' +
        '&wind_speed_unit=kn&forecast_days=3&models=best_match';
    const [forecastData, marine] = await Promise.all([
        fetchJson(forecastUrl, FORECAST_TIMEOUT_MS),
        fetchMarineHourly(lat, lon)
    ]);
    const hourly = forecastData?.hourly ?? {};
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    if (!times.length) {
        throw new Error('Open-Meteo returned no hourly forecast for this position');
    }
    const temps = hourly.temperature_2m ?? [];
    const winds = hourly.wind_speed_10m ?? [];
    const dirs = hourly.wind_direction_10m ?? [];
    const gusts = hourly.wind_gusts_10m ?? [];
    const precips = hourly.precipitation ?? [];
    const pressures = hourly.pressure_msl ?? [];
    // The marine endpoint is a separate request on its own grid, so align it by
    // timestamp rather than trusting the two arrays to share an index.
    const marineByTime = new Map();
    if (marine) {
        marine.time.forEach((t, i) => {
            const height = marine.waveHeight[i];
            const period = marine.wavePeriod[i];
            marineByTime.set(t, {
                height: Number.isFinite(height) ? height : null,
                period: Number.isFinite(period) ? period : null
            });
        });
    }
    const position = formatPosition(lat, lon);
    const periods = [];
    for (let p = 0; p < PERIOD_COUNT; p++) {
        const start = p * PERIOD_HOURS;
        if (start >= times.length)
            break;
        const end = Math.min(start + PERIOD_HOURS, times.length);
        const pTimes = times.slice(start, end);
        const startTime = parseUtc(pTimes[0]);
        const endTime = parseUtc(pTimes[pTimes.length - 1]);
        const pTemps = finiteOnly(temps.slice(start, end));
        const maxWind = maxOf(winds.slice(start, end));
        const maxGust = maxOf(gusts.slice(start, end));
        const direction = meanDirection(finiteOnly(dirs.slice(start, end)));
        const totalPrecip = finiteOnly(precips.slice(start, end)).reduce((a, b) => a + b, 0);
        const pressureTrend = describePressureTrend(pressures.slice(start, end));
        const waves = pTimes.map((t) => marineByTime.get(t)).filter(Boolean);
        const maxWave = maxOf(waves.map((w) => w.height));
        const meanWavePeriod = meanOf(waves.map((w) => w.period));
        const minTemp = pTemps.length ? Math.min(...pTemps) : null;
        const maxTemp = pTemps.length ? Math.max(...pTemps) : null;
        const windDirection = compassPoint(direction);
        const windRange = maxWind !== null ? `${Math.round(maxWind)} kts` : 'n/a';
        const tempRange = minTemp !== null && maxTemp !== null
            ? `${Math.round(minTemp)}°C to ${Math.round(maxTemp)}°C`
            : 'n/a';
        const precipChance = totalPrecip > 0.5 ? `${Math.round(totalPrecip)}mm` : 'None';
        // A bulletin sentence in the order a mariner reads one: wind, then sea,
        // then barometer, then the comfort details.
        const sentences = [];
        if (maxWind !== null) {
            sentences.push(maxGust !== null
                ? `Wind ${windDirection} up to ${Math.round(maxWind)} kts, gusting ${Math.round(maxGust)} kts.`
                : `Wind ${windDirection} up to ${Math.round(maxWind)} kts.`);
        }
        if (maxWave !== null) {
            sentences.push(meanWavePeriod !== null
                ? `Seas to ${maxWave.toFixed(1)} m at ${Math.round(meanWavePeriod)} s.`
                : `Seas to ${maxWave.toFixed(1)} m.`);
        }
        if (pressureTrend)
            sentences.push(`Pressure ${pressureTrend}.`);
        if (tempRange !== 'n/a')
            sentences.push(`Temperature ${tempRange}.`);
        sentences.push(`Precipitation ${precipChance}.`);
        periods.push({
            periodName: `Vessel Vicinity (${start}h - ${start + PERIOD_HOURS}h)`,
            startTime: startTime ? startTime.toISOString() : null,
            endTime: endTime ? endTime.toISOString() : null,
            windRange,
            windDirection,
            riskLevel: assessRisk({ sustainedKts: maxWind, gustKts: maxGust, waveMetres: maxWave }),
            reason: sentences.join(' '),
            tempRange,
            precipChance,
            gustRange: maxGust !== null ? `${Math.round(maxGust)} kts` : null,
            waveHeight: maxWave !== null ? Number(maxWave.toFixed(1)) : null,
            wavePeriod: meanWavePeriod !== null ? Math.round(meanWavePeriod) : null,
            pressure: pressureTrend
        });
    }
    const alerts = probeNwsAlerts ? await fetchNwsAlerts(lat, lon, nwsUserAgent) : [];
    const overallRisk = periods.some((p) => p.riskLevel === 'high')
        ? 'high'
        : periods.some((p) => p.riskLevel === 'moderate')
            ? 'moderate'
            : 'low';
    const value = {
        summary: `Offshore Bulletin for ${position}`,
        overallRisk,
        periods,
        source: marine
            ? 'Open-Meteo global model with marine sea state'
            : 'Open-Meteo global model',
        alerts,
        // NWS zone ids are meaningless outside US waters; null so the UI omits the
        // zone label rather than printing "Zone GLOBAL".
        marineZone: null,
        locName: position,
        synopsis: '',
        provider: 'open-meteo'
    };
    cache.set(key, { at: Date.now(), value });
    return value;
}
/** Test seam: drop memoised forecasts. */
export function clearForecastCache() {
    cache.clear();
}
