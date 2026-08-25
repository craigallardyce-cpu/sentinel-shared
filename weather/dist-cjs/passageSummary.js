"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAVE_BANDS_M = exports.WIND_BANDS_KTS = void 0;
exports.encounterPeriodS = encounterPeriodS;
exports.summarisePassage = summarisePassage;
const sun_js_1 = require("./sun.js");
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
function encounterPeriodS(wavePeriodS, waveAngleDeg, boatSpeedKts) {
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
exports.WIND_BANDS_KTS = [0, 8, 20, 30, 40];
/**
 * Sea bands, in metres.
 *
 * Whole metres of significant wave height. Finer bands would imply the models
 * resolve sea state better than they do, and a cruiser's decisions do not turn
 * on half a metre at these heights anyway.
 */
exports.WAVE_BANDS_M = [0, 1, 2, 3, 4];
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
        const startMs = Date.parse(legs[i - 1].time);
        const hours = (Date.parse(legs[i].time) - startMs) / 3600000;
        if (!Number.isFinite(hours) || hours <= 0)
            continue;
        // The start is carried, not just the span: anything that happens at a
        // single instant on this leg — a tack, a gybe — happens at its beginning,
        // and the leg's own timestamp is its end.
        out.push({ leg: legs[i], hours, startMs });
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
        atNight: (0, sun_js_1.isNightAt)(last.lat, last.lon, Date.parse(last.time)),
        twsKts: last.twsKts,
        gustKts: last.gustKts,
        waveHeightM: last.waveHeightM,
        time: last.time
    };
}
function summarisePassage(route, options = {}) {
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
    let motoringHours = 0;
    const windSamples = [];
    const waveSamples = [];
    for (const { leg, hours: h, startMs } of sailed) {
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
        if ((0, sun_js_1.isNightAt)(leg.lat, leg.lon, Date.parse(leg.time))) {
            nightHours += h;
        }
        // A manoeuvre is judged at the moment the boat TURNS, which is the start
        // of the leg, not its timestamp — legs are stamped with their arrival.
        // The router charges its night penalty at the same instant, and if these
        // two disagree the summary reports sail changes in darkness that the
        // search was never asked to avoid. A leg that gybes at dusk and finishes
        // after dark is a daylight gybe.
        if (leg.manoeuvre && (0, sun_js_1.isNightAt)(leg.lat, leg.lon, startMs)) {
            nightManoeuvres++;
        }
        if (leg.currentKts !== null) {
            currentKnownHours += h;
            if (leg.windAgainstCurrent)
                windAgainstCurrentHours += h;
        }
        if (leg.motoring)
            motoringHours += h;
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
    const positive = (v) => Number.isFinite(v) && v > 0 ? v : null;
    const endurance = positive(options.motoring?.enduranceHours);
    const burn = positive(options.motoring?.fuelLitresPerHour);
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
        windBands: distribute(exports.WIND_BANDS_KTS, 'kt', windSamples),
        waveBands: distribute(exports.WAVE_BANDS_M, 'm', waveSamples),
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
        // Null only when no engine was modelled at all. `route.motoringHours` is
        // the router's own null-when-absent signal; a described engine that was
        // never used reports zero hours, which is a real and different answer.
        motoring: route.motoringHours === null
            ? null
            : {
                hours: Math.round(motoringHours * 100) / 100,
                fraction: round3(motoringHours / hours),
                fuelLitres: route.fuelLitres,
                enduranceHours: endurance,
                usableLitres: endurance !== null && burn !== null ? Math.round(endurance * burn) : null,
                intoLandfall: Boolean(route.legs[route.legs.length - 1]?.motoring)
            },
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
