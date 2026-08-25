"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waveToComponents = waveToComponents;
exports.waveFromComponents = waveFromComponents;
exports.currentToComponents = currentToComponents;
exports.currentFromComponents = currentFromComponents;
exports.speedToKnots = speedToKnots;
exports.fetchMarineField = fetchMarineField;
exports.createWaveSampler = createWaveSampler;
exports.createCurrentSampler = createCurrentSampler;
/**
 * The sea the router sails through: a grid of wave AND current forecasts over
 * the passage area, sampled continuously in space and time.
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
 * Currents ride along on the same request, and that is the only reason they
 * are affordable: Open-Meteo meters coordinates rather than variables, so a
 * grid already paid for carries them free. They are the last thing the roadmap
 * wanted from this endpoint.
 *
 * THE TWO DIRECTIONS HERE USE OPPOSITE CONVENTIONS, which is a trap worth
 * naming loudly. `wave_direction` is where the sea comes FROM, like the wind.
 * `ocean_current_direction` is where the current flows TO — the set, in the
 * ordinary marine sense. That is not an assumption: it was checked against the
 * Florida Straits on 2026-08-25, where the Gulf Stream runs hard north and the
 * endpoint answered 002-005 degrees at 4.2 km/h. Had it been a FROM
 * convention it would have said 180. Get this backwards and every wind-over-
 * tide warning in the app inverts.
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
 * A current speed and set to eastward/northward components, in knots.
 *
 * The set is where the water is GOING, so unlike wind and waves there is no
 * sign flip — a current setting 090 flows east, and its eastward component is
 * positive.
 */
function currentToComponents(speedKts, setDeg) {
    const rad = (setDeg * Math.PI) / 180;
    return { u: speedKts * Math.sin(rad), v: speedKts * Math.cos(rad) };
}
/** Components back to a speed and the set the current runs TO. */
function currentFromComponents(u, v) {
    return {
        speedKts: Math.hypot(u, v),
        setDeg: (((Math.atan2(u, v) * 180) / Math.PI) + 360) % 360
    };
}
/**
 * Convert whatever speed unit the endpoint reported into knots.
 *
 * Read from `hourly_units` rather than assumed. Open-Meteo answers km/h today
 * — confirmed against the live API on 2026-08-25 — but a default that changes
 * under us would otherwise be a silent factor of 3.6 in every current, and a
 * silently wrong current is worse than none. An unrecognised unit is refused
 * rather than guessed at.
 */
function speedToKnots(value, unit) {
    switch ((unit ?? 'km/h').trim().toLowerCase()) {
        case 'kn':
        case 'kt':
        case 'kts':
        case 'knots':
            return value;
        case 'km/h':
        case 'kmh':
            return value / 1.852;
        case 'm/s':
        case 'ms':
            return value * 1.943844;
        case 'mph':
            return value * 0.868976;
        default:
            return NaN;
    }
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
async function fetchMarineField(bounds, options = {}) {
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
        '&hourly=wave_height,wave_direction,wave_period,ocean_current_velocity,ocean_current_direction' +
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
    const currentUnit = points[0]?.hourly_units?.ocean_current_velocity;
    const height = [];
    const u = [];
    const v = [];
    const period = [];
    const currentU = [];
    const currentV = [];
    for (let t = 0; t < times.length; t++) {
        const hPlane = [];
        const uPlane = [];
        const vPlane = [];
        const pPlane = [];
        const cuPlane = [];
        const cvPlane = [];
        for (let i = 0; i < lats.length; i++) {
            const hRow = [];
            const uRow = [];
            const vRow = [];
            const pRow = [];
            const cuRow = [];
            const cvRow = [];
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
                // Currents are their own measurement and their own holes: a point can
                // have a sea state and no current, or the reverse, and neither should
                // cost the other.
                const cv = point?.hourly?.ocean_current_velocity?.[t];
                const cd = point?.hourly?.ocean_current_direction?.[t];
                if (Number.isFinite(cv) && Number.isFinite(cd)) {
                    const kts = speedToKnots(cv, currentUnit);
                    if (Number.isFinite(kts)) {
                        const c = currentToComponents(kts, cd);
                        cuRow.push(c.u);
                        cvRow.push(c.v);
                    }
                    else {
                        cuRow.push(NaN);
                        cvRow.push(NaN);
                    }
                }
                else {
                    cuRow.push(NaN);
                    cvRow.push(NaN);
                }
            }
            hPlane.push(hRow);
            uPlane.push(uRow);
            vPlane.push(vRow);
            pPlane.push(pRow);
            cuPlane.push(cuRow);
            cvPlane.push(cvRow);
        }
        height.push(hPlane);
        u.push(uPlane);
        v.push(vPlane);
        period.push(pPlane);
        currentU.push(cuPlane);
        currentV.push(cvPlane);
    }
    return { lats, lons, times, height, u, v, period, currentU, currentV };
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
/**
 * A current sampler over the same fetched field.
 *
 * Kept separate from the wave sampler rather than folded into it because the
 * two are independent measurements with independent holes: a grid cell can
 * carry a sea state and no current, or a current and no sea state, and a
 * combined sampler would have to throw away one to report the other.
 *
 * Currents interpolate as vectors for the same reason waves do, and with more
 * at stake — a tidal gate that runs one way then the other has neighbouring
 * cells 180 degrees apart, and averaging those as degrees produces a confident
 * reading at right angles to both.
 *
 * Land corners are dropped and the remaining sea corners reweighted, as with
 * waves. Unlike waves, a cell that resolves to almost no current returns a set
 * of zero rather than null: "no current here" is a real and useful answer,
 * where "a sea running from nowhere" is not.
 */
function createCurrentSampler(field) {
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
            let u = 0;
            let v = 0;
            for (const c of corners) {
                const cu = field.currentU[ti]?.[c.yi]?.[c.xi];
                const cv = field.currentV[ti]?.[c.yi]?.[c.xi];
                if (!Number.isFinite(cu) || !Number.isFinite(cv))
                    continue;
                const w = c.w > 0 ? c.w : 1e-9;
                weight += w;
                u += cu * w;
                v += cv * w;
            }
            if (weight <= 0)
                return null;
            return { u: u / weight, v: v / weight };
        };
        const before = blend(t.lo);
        const after = blend(t.hi);
        if (!before || !after)
            return null;
        const mix = (a, b) => a + (b - a) * t.frac;
        return currentFromComponents(mix(before.u, after.u), mix(before.v, after.v));
    };
}
