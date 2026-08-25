/**
 * The period at which the boat meets the waves, in seconds.
 *
 * Not the same as the wave period, and the difference is the whole point: a
 * boat punching into a sea meets it far more often than a boat running away
 * from the same sea. The standard deep-water relation is
 *
 *     ω_e = ω − (ω²·v/g)·cos μ
 *
 * where μ is the angle between the boat's heading and the direction the waves
 * are TRAVELLING. `waveAngleDeg` on a leg is measured against where the waves
 * come FROM — 0 is a head sea — so μ is its supplement.
 *
 * Returns null when the boat is running with the waves at close to their own
 * speed. There the encounter period goes to infinity and then negative as the
 * waves start overtaking from ahead, and neither answer means anything useful
 * to a cruising boat. Saying nothing is better than reporting a 400-second
 * roll period.
 */
export function encounterPeriodS(wavePeriodS, waveAngleDeg, boatSpeedKts) {
    if (!Number.isFinite(wavePeriodS) || wavePeriodS <= 0)
        return null;
    const g = 9.81;
    const speedMs = (boatSpeedKts * 1852) / 3600;
    const omega = (2 * Math.PI) / wavePeriodS;
    // Waves come FROM waveAngleDeg off the bow; they TRAVEL toward its supplement.
    const mu = (180 - Math.abs(waveAngleDeg)) * (Math.PI / 180);
    const omegaE = omega - ((omega * omega * speedMs) / g) * Math.cos(mu);
    if (!Number.isFinite(omegaE) || omegaE <= 1e-6)
        return null;
    return (2 * Math.PI) / omegaE;
}
/**
 * The sun's elevation above the horizon, in degrees.
 *
 * The low-precision solar position algorithm, good to about a hundredth of a
 * degree — which is three or four orders of magnitude better than a passage
 * plan needs, and worth having because it is arithmetic rather than a service.
 * A boat mid-ocean can work out when it gets dark with no network at all,
 * which is the same reason the routing itself runs client-side.
 */
export function solarElevationDeg(lat, lon, timeMs) {
    const rad = Math.PI / 180;
    // Days since J2000.0.
    const d = timeMs / 86400000 + 2440587.5 - 2451545.0;
    const meanAnomaly = (357.529 + 0.98560028 * d) * rad;
    const meanLongitude = (280.459 + 0.98564736 * d) * rad;
    const eclipticLongitude = meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
    const obliquity = (23.439 - 0.00000036 * d) * rad;
    const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
    // Greenwich mean sidereal time, in degrees, then local hour angle.
    const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
    const hourAngle = (gmstHours * 15 + lon) * rad - rightAscension;
    const elevation = Math.asin(Math.sin(lat * rad) * Math.sin(declination) +
        Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle));
    return elevation / rad;
}
/**
 * Dark, for a watch-keeping purpose.
 *
 * The threshold is the sun's upper limb on the horizon allowing for
 * refraction, which is the same instant an almanac calls sunset. Civil
 * twilight would be defensible too, but a crew changing a headsail at
 * nautical dusk is working in the dark whatever the definition says, and the
 * conservative line is the one that calls more of the passage night.
 */
const NIGHT_ELEVATION_DEG = -0.833;
export function isNightAt(lat, lon, timeMs) {
    return solarElevationDeg(lat, lon, timeMs) < NIGHT_ELEVATION_DEG;
}
/**
 * How near the encounter period has to be to the boat's own roll period to
 * count as resonant. A boat rolls hardest when the sea arrives in step with
 * the roll it already has, and the response peak is broad rather than sharp.
 */
const RESONANCE_LOW = 0.8;
const RESONANCE_HIGH = 1.25;
/** Upwind below this true wind angle, downwind above the other. */
const REACHING_FROM_DEG = 60;
const REACHING_TO_DEG = 120;
/** Where hard-upwind starts: close-hauled, and enough breeze to be wet. */
const HARD_UPWIND_TWA_DEG = 60;
const HARD_UPWIND_KTS = 15;
/**
 * Wind bands, in knots.
 *
 * Chosen around what a cruising boat does rather than around round numbers: 8
 * is roughly where a cruiser stops sailing and starts motoring, 20 is the
 * first reef, 30 is the second and the point where a passage becomes work, 40
 * is heavy weather.
 */
export const WIND_BANDS_KTS = [0, 8, 20, 30, 40];
/**
 * Sea bands, in metres.
 *
 * Whole metres of significant wave height. Finer bands would imply the models
 * resolve sea state better than they do, and a cruiser's decisions do not turn
 * on half a metre at these heights anyway.
 */
export const WAVE_BANDS_M = [0, 1, 2, 3, 4];
function bandLabel(from, to, unit) {
    if (from === 0)
        return `<${to}${unit}`;
    if (to === null)
        return `>${from}${unit}`;
    return `${from}–${to}${unit}`;
}
function distribute(edges, unit, samples) {
    const total = samples.reduce((sum, s) => sum + s.hours, 0);
    return edges.map((from, i) => {
        const to = i === edges.length - 1 ? null : edges[i + 1];
        const hours = samples
            .filter((s) => s.value >= from && (to === null || s.value < to))
            .reduce((sum, s) => sum + s.hours, 0);
        return {
            from,
            to,
            label: bandLabel(from, to, unit),
            hours: Math.round(hours * 100) / 100,
            fraction: total > 0 ? hours / total : 0
        };
    });
}
/**
 * The hours each leg was sailed for, paired with the conditions it was sailed
 * in.
 *
 * A leg reports the conditions sampled at its *start* and the time of its
 * *end*, which is the convention the router has always used — so the hours a
 * leg's conditions applied for run from the previous leg's timestamp to its
 * own. The first leg is the departure point itself: zero length, no wind
 * sampled, and excluded here rather than counted as a calm.
 */
function legHours(legs) {
    const out = [];
    for (let i = 1; i < legs.length; i++) {
        const hours = (Date.parse(legs[i].time) - Date.parse(legs[i - 1].time)) / 3600000;
        if (!Number.isFinite(hours) || hours <= 0)
            continue;
        out.push({ leg: legs[i], hours });
    }
    return out;
}
/**
 * Summarise a computed route.
 *
 * Returns null for a route with nothing to summarise — one that never left the
 * departure point. That is a real outcome (a start inside an obstacle, a sea
 * above the limit set, a flat calm) and the route's own warnings already
 * explain it far better than an all-zero summary would.
 */
/**
 * Conditions at the end of the passage, or null if it never got there.
 *
 * Taken from the last leg, which is the arrival itself — the router builds it
 * at the destination with the conditions it closed in.
 */
function landfallOf(route) {
    if (!route.reachedDestination)
        return null;
    const last = route.legs[route.legs.length - 1];
    if (!last)
        return null;
    return {
        atNight: isNightAt(last.lat, last.lon, Date.parse(last.time)),
        twsKts: last.twsKts,
        gustKts: last.gustKts,
        waveHeightM: last.waveHeightM,
        time: last.time
    };
}
export function summarisePassage(route, options = {}) {
    const sailed = legHours(route.legs);
    if (!sailed.length)
        return null;
    const hours = sailed.reduce((sum, s) => sum + s.hours, 0);
    if (hours <= 0)
        return null;
    let minKts = Infinity;
    let maxKts = -Infinity;
    let windHours = 0;
    let maxGustKts = null;
    let upwind = 0;
    let reaching = 0;
    let downwind = 0;
    let hardUpwindHours = 0;
    let seaHours = 0;
    const rollPeriodS = Number.isFinite(options.rollPeriodS) && options.rollPeriodS > 0
        ? options.rollPeriodS
        : null;
    let resonantHours = 0;
    let resonanceUnknownHours = 0;
    let nightHours = 0;
    let nightManoeuvres = 0;
    let windAgainstCurrentHours = 0;
    let currentKnownHours = 0;
    const windSamples = [];
    const waveSamples = [];
    for (const { leg, hours: h } of sailed) {
        if (Number.isFinite(leg.twsKts)) {
            minKts = Math.min(minKts, leg.twsKts);
            maxKts = Math.max(maxKts, leg.twsKts);
            windHours += leg.twsKts * h;
            windSamples.push({ value: leg.twsKts, hours: h });
        }
        if (leg.gustKts !== null && Number.isFinite(leg.gustKts)) {
            maxGustKts = maxGustKts === null ? leg.gustKts : Math.max(maxGustKts, leg.gustKts);
        }
        // Judged at the leg's own position and time, so a passage long enough to
        // change time zone gets its nights where they actually fall rather than
        // where the departure port's clock says.
        if (isNightAt(leg.lat, leg.lon, Date.parse(leg.time))) {
            nightHours += h;
            if (leg.manoeuvre)
                nightManoeuvres++;
        }
        if (leg.currentKts !== null) {
            currentKnownHours += h;
            if (leg.windAgainstCurrent)
                windAgainstCurrentHours += h;
        }
        const twa = leg.twaDeg;
        if (twa < REACHING_FROM_DEG)
            upwind += h;
        else if (twa <= REACHING_TO_DEG)
            reaching += h;
        else
            downwind += h;
        if (twa < HARD_UPWIND_TWA_DEG && leg.twsKts > HARD_UPWIND_KTS)
            hardUpwindHours += h;
        // Legs the marine forecast did not reach are left out of the sea
        // distribution rather than counted as calm water, and the coverage figure
        // is what says how much of the passage that was.
        if (leg.waveHeightM !== null && Number.isFinite(leg.waveHeightM)) {
            waveSamples.push({ value: leg.waveHeightM, hours: h });
            seaHours += h;
            if (rollPeriodS !== null && leg.wavePeriodS !== null && leg.waveAngleDeg !== null) {
                const te = encounterPeriodS(leg.wavePeriodS, leg.waveAngleDeg, leg.boatSpeedKts);
                if (te === null)
                    resonanceUnknownHours += h;
                else if (te >= rollPeriodS * RESONANCE_LOW && te <= rollPeriodS * RESONANCE_HIGH) {
                    resonantHours += h;
                }
            }
        }
    }
    const round3 = (n) => Math.round(n * 1000) / 1000;
    return {
        hours: Math.round(hours * 100) / 100,
        wind: {
            minKts: Number.isFinite(minKts) ? Math.round(minKts * 10) / 10 : 0,
            maxKts: Number.isFinite(maxKts) ? Math.round(maxKts * 10) / 10 : 0,
            meanKts: hours > 0 ? Math.round((windHours / hours) * 10) / 10 : 0,
            maxGustKts: maxGustKts === null ? null : Math.round(maxGustKts * 10) / 10
        },
        pointOfSail: {
            upwind: round3(upwind / hours),
            reaching: round3(reaching / hours),
            downwind: round3(downwind / hours)
        },
        windBands: distribute(WIND_BANDS_KTS, 'kt', windSamples),
        waveBands: distribute(WAVE_BANDS_M, 'm', waveSamples),
        hardUpwind: {
            fraction: round3(hardUpwindHours / hours),
            hours: Math.round(hardUpwindHours * 100) / 100,
            thresholdKts: HARD_UPWIND_KTS,
            twaDeg: HARD_UPWIND_TWA_DEG
        },
        seaStateCoverage: round3(seaHours / hours),
        night: {
            fraction: round3(nightHours / hours),
            hours: Math.round(nightHours * 100) / 100,
            manoeuvres: nightManoeuvres
        },
        windAgainstCurrent: currentKnownHours > 0
            ? {
                fraction: round3(windAgainstCurrentHours / hours),
                hours: Math.round(windAgainstCurrentHours * 100) / 100
            }
            : null,
        landfall: landfallOf(route),
        rollResonance: rollPeriodS === null
            ? null
            : {
                fraction: round3(resonantHours / hours),
                hours: Math.round(resonantHours * 100) / 100,
                rollPeriodS,
                unknownHours: Math.round(resonanceUnknownHours * 100) / 100
            }
    };
}
