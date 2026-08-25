"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waveToComponents = waveToComponents;
exports.waveFromComponents = waveFromComponents;
exports.fetchWaveField = fetchWaveField;
exports.createWaveSampler = createWaveSampler;
/**
 * The sea the router sails through: a grid of wave forecasts over the passage
 * area, sampled continuously in space and time.
 *
 * The companion to `windField.ts`, and deliberately shaped like it — fetched
 * once for the whole passage, held in memory, and reused by every departure
 * time being compared. Wind is why a passage is fast; the sea is usually why
 * it was unpleasant long before the wind said so.
 *
 * Two things differ from the wind field, both on purpose:
 *
 *   - IT IS COARSER. 2° by default rather than 1°. Wave fields vary far more
 *     smoothly than wind, and every coordinate is metered by Open-Meteo's free
 *     tier — a passage that already fetches two wind models should not triple
 *     its spend for a field this smooth.
 *   - IT HAS HOLES. The marine endpoint answers for land: HTTP 200, with every
 *     wave value null. That is not an error, and `createWaveSampler` treats it
 *     as one grid corner that is not sea rather than as a failed forecast,
 *     which is what keeps coastal passages from losing their sea state
 *     entirely.
 *
 * Direction is interpolated as vectors, never as degrees, for the same reason
 * the wind is: averaging 350° and 10° arithmetically gives 180°, and a router
 * told it has a following sea when it is punching into one will promise a
 * passage nobody can sail.
 */
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const FETCH_TIMEOUT_MS = 20000;
/**
 * The marine models publish a shorter horizon than the atmospheric ones.
 * Open-Meteo caps the marine endpoint well below the 16 days the forecast
 * endpoint will serve, so asking for more is answered with less rather than
 * refused — and a sampler that returns null past the end of its own time axis
 * already says "no sea state here" correctly. The cap is here so the request
 * is honest about what it wants.
 */
const MAX_MARINE_DAYS = 8;
function axis(from, to, stepDeg) {
    const values = [];
    for (let v = from; v <= to + 1e-9; v += stepDeg)
        values.push(Math.round(v * 1000) / 1000);
    if (values.length === 0)
        values.push(from);
    return values;
}
/**
 * A wave direction to a unit vector.
 *
 * `wave_direction` is the direction the sea is running FROM, the same
 * meteorological convention `wind_direction_10m` uses, so the two can be
 * compared without either being flipped first. Only the direction is carried
 * as a vector: height is interpolated separately, because a big sea from the
 * north meeting a small one from the south should average to a small confused
 * sea, not to the vector sum of two heights.
 */
function waveToComponents(directionFromDeg) {
    const rad = (directionFromDeg * Math.PI) / 180;
    return { u: -Math.sin(rad), v: -Math.cos(rad) };
}
/** A direction unit vector back to the direction the sea runs FROM. */
function waveFromComponents(u, v) {
    return (((Math.atan2(-u, -v) * 180) / Math.PI) + 360) % 360;
}
/**
 * Fetch the wave grid for a passage.
 *
 * The request is shaped exactly like the wind field's — many coordinates in
 * one call, one forecast object per point, in request order — because that is
 * the response shape this codebase has actually seen from Open-Meteo. The
 * single-point case still comes back as a bare object rather than an array of
 * one, which is why both are accepted.
 */
async function fetchWaveField(bounds, options = {}) {
    const { resolutionDeg = 2, days = 7, fetchImpl = fetch } = options;
    const lats = axis(bounds.south, bounds.north, resolutionDeg);
    const lons = axis(bounds.west, bounds.east, resolutionDeg);
    const latParam = [];
    const lonParam = [];
    for (const la of lats)
        for (const lo of lons) {
            latParam.push(la);
            lonParam.push(lo);
        }
    const url = `${MARINE_URL}?latitude=${latParam.join(',')}&longitude=${lonParam.join(',')}` +
        '&hourly=wave_height,wave_direction,wave_period' +
        `&forecast_days=${Math.min(MAX_MARINE_DAYS, Math.max(1, Math.round(days)))}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok)
        throw new Error(`Open-Meteo wave field returned HTTP ${res.status}`);
    const payload = await res.json();
    // One coordinate comes back as an object, many as an array.
    const points = Array.isArray(payload) ? payload : [payload];
    if (points.length !== lats.length * lons.length) {
        throw new Error(`Open-Meteo returned ${points.length} wave points for a ${lats.length}x${lons.length} grid.`);
    }
    const timeStrings = points[0]?.hourly?.time ?? [];
    if (!timeStrings.length)
        throw new Error('Open-Meteo wave field contained no hourly data.');
    // Upstream times carry no zone suffix and default to GMT.
    const times = timeStrings.map((t) => Date.parse(/[Zz+]/.test(t) ? t : `${t}Z`));
    const height = [];
    const u = [];
    const v = [];
    const period = [];
    for (let t = 0; t < times.length; t++) {
        const hPlane = [];
        const uPlane = [];
        const vPlane = [];
        const pPlane = [];
        for (let i = 0; i < lats.length; i++) {
            const hRow = [];
            const uRow = [];
            const vRow = [];
            const pRow = [];
            for (let j = 0; j < lons.length; j++) {
                const point = points[i * lons.length + j];
                const h = point?.hourly?.wave_height?.[t];
                const dir = point?.hourly?.wave_direction?.[t];
                const per = point?.hourly?.wave_period?.[t];
                // Height and direction travel together: a height with no direction
                // cannot be turned into an angle to the boat, and is no use to the
                // router. Period is genuinely optional — it is reported, not used.
                if (Number.isFinite(h) && Number.isFinite(dir)) {
                    const c = waveToComponents(dir);
                    hRow.push(h);
                    uRow.push(c.u);
                    vRow.push(c.v);
                    pRow.push(Number.isFinite(per) ? per : NaN);
                }
                else {
                    hRow.push(NaN);
                    uRow.push(NaN);
                    vRow.push(NaN);
                    pRow.push(NaN);
                }
            }
            hPlane.push(hRow);
            uPlane.push(uRow);
            vPlane.push(vRow);
            pPlane.push(pRow);
        }
        height.push(hPlane);
        u.push(uPlane);
        v.push(vPlane);
        period.push(pPlane);
    }
    return { lats, lons, times, height, u, v, period };
}
function slot(values, target) {
    if (!values.length)
        return null;
    if (target < values[0] || target > values[values.length - 1])
        return null;
    let hi = 1;
    while (hi < values.length - 1 && values[hi] < target)
        hi++;
    const lo = hi - 1;
    const span = values[hi] - values[lo];
    return { lo, hi, frac: span === 0 ? 0 : (target - values[lo]) / span };
}
/**
 * A sampler over a fetched field, for the router to call.
 *
 * Outside the grid in space or time it returns null, like the wind sampler,
 * and for the same reason: sea state assumed to continue past the edge of the
 * forecast is sea state nobody forecast.
 *
 * Inside the grid it is more forgiving than the wind sampler in one specific
 * way. A cell with a land corner has no wave value there, and refusing to
 * interpolate would leave every coastal passage — which is most of them — with
 * no sea state at all. So the corners that are sea are used, reweighted to sum
 * to one, and only a cell with no sea corners at all returns null. What that
 * gives near a coast is the open-water sea state nearby, which is the honest
 * thing to say about it: not that a shore is smooth, but that this is the sea
 * running outside it.
 */
function createWaveSampler(field) {
    return (lat, lon, timeMs) => {
        const y = slot(field.lats, lat);
        const x = slot(field.lons, lon);
        const t = slot(field.times, timeMs);
        if (!y || !x || !t)
            return null;
        const blend = (ti) => {
            const corners = [
                { yi: y.lo, xi: x.lo, w: (1 - y.frac) * (1 - x.frac) },
                { yi: y.lo, xi: x.hi, w: (1 - y.frac) * x.frac },
                { yi: y.hi, xi: x.lo, w: y.frac * (1 - x.frac) },
                { yi: y.hi, xi: x.hi, w: y.frac * x.frac }
            ];
            let weight = 0;
            let height = 0;
            let u = 0;
            let v = 0;
            let periodWeight = 0;
            let period = 0;
            for (const c of corners) {
                const h = field.height[ti]?.[c.yi]?.[c.xi];
                const cu = field.u[ti]?.[c.yi]?.[c.xi];
                const cv = field.v[ti]?.[c.yi]?.[c.xi];
                if (!Number.isFinite(h) || !Number.isFinite(cu) || !Number.isFinite(cv))
                    continue;
                // A position exactly on a grid line gives its corners zero bilinear
                // weight in that axis, so a cell can legitimately resolve from one
                // corner alone. A floor weight keeps such a cell from being thrown
                // away as "no sea corners" when its only contributor sits on the line.
                const w = c.w > 0 ? c.w : 1e-9;
                weight += w;
                height += h * w;
                u += cu * w;
                v += cv * w;
                const p = field.period[ti]?.[c.yi]?.[c.xi];
                if (Number.isFinite(p)) {
                    periodWeight += w;
                    period += p * w;
                }
            }
            if (weight <= 0)
                return null;
            return {
                height: height / weight,
                u: u / weight,
                v: v / weight,
                period: periodWeight > 0 ? period / periodWeight : null
            };
        };
        const before = blend(t.lo);
        const after = blend(t.hi);
        if (!before || !after)
            return null;
        const mix = (a, b) => a + (b - a) * t.frac;
        const u = mix(before.u, after.u);
        const v = mix(before.v, after.v);
        // Two seas from opposite directions cancel to a near-zero vector, and any
        // direction read off it would be noise. Say nothing rather than invent one.
        if (Math.hypot(u, v) < 1e-6)
            return null;
        const periodS = before.period !== null && after.period !== null
            ? mix(before.period, after.period)
            : before.period ?? after.period;
        return {
            heightM: mix(before.height, after.height),
            directionDeg: waveFromComponents(u, v),
            periodS
        };
    };
}
