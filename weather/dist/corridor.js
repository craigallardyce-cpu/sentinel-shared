import { distanceNm } from './routing.js';
const DEFAULT_LIMITS = { windKts: 30, gustKts: 40, waveM: 4 };
/**
 * How far under the limit the old forecast had to be for a breach to count as
 * genuinely new.
 *
 * Without this, "not in your plan" fires on arithmetic. Two forecasts fetched
 * twenty minutes apart, interpolated from grids with different bounds, will
 * disagree in the third decimal — and a sea that was 1.09 m against a 1.10 m
 * limit and is now 1.11 m gets reported as weather that has appeared since
 * departure. It has not; the number moved by a centimetre.
 *
 * Ten percent is a margin, not a threshold on the hazard itself: the breach is
 * still reported, it is simply not called NEW unless the old forecast was
 * comfortably clear of the limit. Crying wolf is the one failure mode this
 * feature cannot survive — an advisory that is wrong at the margin gets muted,
 * and then it is not there for the gale.
 */
const NEW_BREACH_MARGIN = 0.9;
function breachesAt(lat, lon, timeMs, samplers, limits) {
    const out = [];
    const w = samplers.wind(lat, lon, timeMs);
    if (w && Number.isFinite(w.speedKts) && w.speedKts >= limits.windKts) {
        out.push({ kind: 'wind', value: Math.round(w.speedKts * 10) / 10, limit: limits.windKts, isNew: false });
    }
    if (w && w.gustKts !== null && w.gustKts !== undefined && w.gustKts >= limits.gustKts) {
        out.push({ kind: 'gust', value: Math.round(w.gustKts * 10) / 10, limit: limits.gustKts, isNew: false });
    }
    const s = samplers.waves?.(lat, lon, timeMs);
    if (s && Number.isFinite(s.heightM) && s.heightM >= limits.waveM) {
        out.push({ kind: 'sea', value: Math.round(s.heightM * 10) / 10, limit: limits.waveM, isNew: false });
    }
    return out;
}
/**
 * Walk a planned track against a forecast and report what it runs into.
 *
 * Sampled at the track's own legs, which is the right resolution: the legs are
 * where the boat is expected to be, hour by hour, and a hazard the boat does
 * not pass through is not this feature's business — the wind overlay already
 * shows the weather everywhere.
 *
 * `plannedWith` is the forecast the passage was originally planned from. Given
 * it, each hazard is marked new or not. Without it every hazard is reported as
 * not new, which is honest: with nothing to compare against, nobody can say
 * whether this was known at departure.
 */
export function scanHazards(route, samplers, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
    const hazards = [];
    const comparedToPlan = Boolean(options.plannedWith);
    const now = options.now ?? (route.legs.length ? Date.parse(route.legs[0].time) : 0);
    for (const leg of route.legs) {
        const timeMs = Date.parse(leg.time);
        if (!Number.isFinite(timeMs))
            continue;
        const breaches = breachesAt(leg.lat, leg.lon, timeMs, samplers, limits);
        if (!breaches.length)
            continue;
        // Was this already there when the passage was planned? Compared at the
        // same position and hour, so a low that merely deepened a little still
        // counts as known, and one that has arrived a day early does not.
        //
        // Kind by kind, not position by position. A leg that always had a big sea
        // and has since grown gale-force gusts must report the gusts as new.
        if (options.plannedWith) {
            // Judged against a SOFTENED limit, so a value that was already close to
            // breaking counts as known. See NEW_BREACH_MARGIN.
            const softened = {
                windKts: limits.windKts * NEW_BREACH_MARGIN,
                gustKts: limits.gustKts * NEW_BREACH_MARGIN,
                waveM: limits.waveM * NEW_BREACH_MARGIN
            };
            const before = breachesAt(leg.lat, leg.lon, timeMs, options.plannedWith, softened);
            const nearlyBrokenBefore = new Set(before.map((b) => b.kind));
            for (const b of breaches)
                b.isNew = !nearlyBrokenBefore.has(b.kind);
        }
        const isNew = breaches.some((b) => b.isNew);
        hazards.push({
            lat: leg.lat,
            lon: leg.lon,
            time: leg.time,
            hoursAway: Math.round(((timeMs - now) / 3600000) * 10) / 10,
            breaches,
            isNew
        });
    }
    // Worst is judged on how far over the limit a breach is, in proportion —
    // so 45 knots against a 30-knot limit outranks 4.5 m against 4 m, which is
    // the order a skipper reads them in. New hazards win ties, because an
    // unknown gale outranks one already accepted.
    const severity = (h) => Math.max(...h.breaches.map((b) => b.value / b.limit)) + (h.isNew ? 0.001 : 0);
    const worst = hazards.length
        ? hazards.reduce((a, b) => (severity(a) >= severity(b) ? a : b))
        : null;
    const soonest = hazards.length
        ? hazards.reduce((a, b) => (a.hoursAway <= b.hoursAway ? a : b))
        : null;
    return { hazards, worst, soonest, comparedToPlan, limits };
}
/** Below this share of the widest band, a narrowing is worth calling a decision. */
const PINCH_RATIO = 0.55;
/**
 * Positions on a front are ranked by their spread, which is O(n²) on a set that
 * can be a few hundred wide. Capped so a long passage cannot quietly cost
 * seconds; the sample is even across the front, so the width it measures is
 * the same width.
 */
const MAX_POINTS_PER_BAND = 60;
function evenSample(items, max) {
    if (items.length <= max)
        return items;
    const step = items.length / max;
    const out = [];
    for (let i = 0; i < max; i++)
        out.push(items[Math.floor(i * step)]);
    return out;
}
function spreadNm(points) {
    let worst = 0;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const d = distanceNm(points[i].lat, points[i].lon, points[j].lat, points[j].lon);
            if (d > worst)
                worst = d;
        }
    }
    return Math.round(worst * 10) / 10;
}
/**
 * Turn the router's retained fronts into bands of clear, reachable water.
 *
 * The corridor is NOT a buffer around the optimal track. It is the reachable
 * set minus the water the boat must not be in, which is why its width means
 * something: wide where the boat has options, narrow where the weather has
 * taken them. A band with no clear points at all is dropped rather than drawn
 * empty — there is no advice to give for an hour with nowhere to be.
 */
export function buildCorridor(fronts) {
    const bands = [];
    for (const front of fronts) {
        const clear = evenSample(front.points.filter((p) => p.clear).map((p) => ({ lat: p.lat, lon: p.lon })), MAX_POINTS_PER_BAND);
        if (clear.length < 2)
            continue;
        bands.push({
            timeMs: front.timeMs,
            hoursFromDeparture: front.hoursFromDeparture,
            points: clear,
            widthNm: spreadNm(clear)
        });
    }
    if (!bands.length)
        return { bands, pinch: null, widest: null };
    const widest = bands.reduce((a, b) => (a.widthNm >= b.widthNm ? a : b));
    const narrowest = bands.reduce((a, b) => (a.widthNm <= b.widthNm ? a : b));
    // The first and last bands are narrow because the passage starts and ends at
    // a point, not because anything is deciding — so a pinch only counts if it is
    // somewhere in the middle.
    const isInterior = narrowest !== bands[0] && narrowest !== bands[bands.length - 1];
    const pinch = isInterior && widest.widthNm > 0 && narrowest.widthNm / widest.widthNm <= PINCH_RATIO
        ? narrowest
        : null;
    return { bands, pinch, widest };
}
export function buildAdvisory(route, scan, corridor, filedEtaHours = null) {
    const fresh = scan.hazards.filter((h) => h.isNew);
    // A new hazard always leads, even where a known one is worse: the known one
    // was accepted at departure and the new one has never been decided about.
    const pool = fresh.length ? fresh : scan.hazards;
    // Ranked on the breaches that are actually new when there are any, so a leg
    // whose old hazard is severe cannot outrank one whose NEW hazard is worse.
    const severity = (h) => {
        const relevant = fresh.length ? h.breaches.filter((b) => b.isNew) : h.breaches;
        const scored = relevant.length ? relevant : h.breaches;
        return Math.max(...scored.map((b) => b.value / b.limit));
    };
    const headline = pool.length ? pool.reduce((a, b) => (severity(a) >= severity(b) ? a : b)) : null;
    return {
        headline,
        headlineIsNew: Boolean(headline?.isNew),
        scan,
        corridor,
        costHours: filedEtaHours !== null && Number.isFinite(route.etaHours)
            ? Math.round((route.etaHours - filedEtaHours) * 10) / 10
            : null
    };
}
