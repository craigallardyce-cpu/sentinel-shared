import { boatSpeed, foldTwa, GENERIC_POLARS } from './polars.js';
/**
 * Learning a boat's polar from its own sailing.
 *
 * The polar is the largest source of error in a routed passage: every decision
 * the router makes follows from how fast this boat goes at a given wind angle
 * and strength. A generic curve produces a plausible route; the boat's own
 * numbers produce a useful one.
 *
 * This accumulates rather than mines history. The app's telemetry recorder
 * keeps 10-second samples for 48 hours and prunes — deliberately, because it
 * exists to draw graphs, not to be an archive — and 48 hours cannot fill a
 * polar, since a boat meets some angles and strengths only a few times a
 * season. So each sample updates a running aggregate and is then forgotten:
 * the polar improves over seasons while the record stays kilobytes, and
 * nothing about the existing retention has to change.
 *
 * What the aggregate stores per grid node is a coarse histogram of observed
 * speeds, not a mean. A polar describes the boat sailed well, not the boat
 * averaged over a reefed-too-long afternoon with a fouled bottom, so the
 * derived figure is a high percentile. Histograms also merge by addition,
 * which matters when two devices aboard have each seen part of the season.
 */
/** Speed histogram resolution. Quarter of a knot is finer than any polar needs. */
const SPEED_BUCKET_KTS = 0.25;
const MAX_PLAUSIBLE_STW = 40;
/** Where the last sample left off, so steadiness can be judged. Not persisted. */
const lastSampleByAccumulator = new WeakMap();
const DEFAULT_TWA = [0, 35, 40, 50, 60, 75, 90, 110, 120, 135, 150, 165, 180];
const DEFAULT_TWS = [6, 8, 10, 12, 14, 16, 20, 25];
export function createPolarAccumulator(twaValues = DEFAULT_TWA, twsValues = DEFAULT_TWS) {
    return {
        version: 1,
        twaValues: [...twaValues],
        twsValues: [...twsValues],
        bins: {},
        accepted: 0,
        rejected: 0,
        firstSampleAt: null,
        lastSampleAt: null
    };
}
/** Index of the nearest grid value — samples land on nodes, not in ranges. */
function nearestIndex(values, target) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < values.length; i++) {
        const d = Math.abs(values[i] - target);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    }
    return best;
}
/** True wind angle from the wind's direction and the boat's heading. */
export function trueWindAngle(twdDeg, headingDeg) {
    return foldTwa(headingDeg - twdDeg);
}
/** Smallest absolute difference between two headings, 0-180. */
function headingDelta(a, b) {
    return foldTwa(a - b);
}
/**
 * Offer one telemetry sample to the polar.
 *
 * Returns why a sample was refused rather than silently dropping it: a boat
 * whose polar is not filling in should be able to find out that every sample
 * is being rejected as motoring because its RPM sensor reads 600 at idle.
 */
export function addSample(accumulator, sample, options = {}) {
    const { motoringRpm = 400, minTwsKts = 2, minStwKts = 0.3, maxHeadingChangeDeg = 12, maxTwsChangeKts = 6, steadyWindowMs = 60000 } = options;
    const reject = (reason) => {
        accumulator.rejected++;
        // Still the most recent thing seen, so the next sample is judged against
        // where the boat actually is rather than the last good state.
        lastSampleByAccumulator.set(accumulator, sample);
        return { accepted: false, reason };
    };
    const { t, stw, tws, twd, heading, engineRpm } = sample;
    if (![t, stw, tws, twd, heading].every((v) => Number.isFinite(v))) {
        accumulator.rejected++;
        return { accepted: false, reason: 'incomplete' };
    }
    if (stw < 0 || stw > MAX_PLAUSIBLE_STW || tws < 0)
        return reject('implausible');
    if (Number.isFinite(engineRpm) && engineRpm > motoringRpm)
        return reject('motoring');
    if (tws < minTwsKts)
        return reject('becalmed');
    if (stw < minStwKts)
        return reject('not-moving');
    const previous = lastSampleByAccumulator.get(accumulator);
    if (previous && t - previous.t <= steadyWindowMs && t > previous.t) {
        if (headingDelta(heading, previous.heading) > maxHeadingChangeDeg)
            return reject('manoeuvring');
        if (Math.abs(tws - previous.tws) > maxTwsChangeKts)
            return reject('wind-unsettled');
    }
    const twa = trueWindAngle(twd, heading);
    const twaIndex = nearestIndex(accumulator.twaValues, twa);
    const twsIndex = nearestIndex(accumulator.twsValues, tws);
    const key = `${twaIndex}:${twsIndex}`;
    const bin = accumulator.bins[key] ?? { count: 0, hist: {} };
    const bucket = Math.round(stw / SPEED_BUCKET_KTS);
    bin.hist[bucket] = (bin.hist[bucket] ?? 0) + 1;
    bin.count++;
    accumulator.bins[key] = bin;
    accumulator.accepted++;
    accumulator.firstSampleAt = accumulator.firstSampleAt ?? t;
    accumulator.lastSampleAt = Math.max(accumulator.lastSampleAt ?? t, t);
    lastSampleByAccumulator.set(accumulator, sample);
    return { accepted: true, twaDeg: twa };
}
/** The speed at a percentile of a bin's histogram. */
function percentileOf(bin, percentile) {
    const buckets = Object.keys(bin.hist)
        .map(Number)
        .sort((a, b) => a - b);
    if (!buckets.length)
        return 0;
    const target = Math.max(1, Math.ceil(bin.count * percentile));
    let seen = 0;
    for (const bucket of buckets) {
        seen += bin.hist[bucket];
        if (seen >= target)
            return bucket * SPEED_BUCKET_KTS;
    }
    return buckets[buckets.length - 1] * SPEED_BUCKET_KTS;
}
/** Add one accumulator into another — two devices, two halves of a season. */
export function mergeAccumulators(a, b) {
    if (a.twaValues.join() !== b.twaValues.join() ||
        a.twsValues.join() !== b.twsValues.join()) {
        throw new Error('Polar accumulators can only be merged when they share a grid.');
    }
    const merged = createPolarAccumulator(a.twaValues, a.twsValues);
    for (const source of [a, b]) {
        for (const [key, bin] of Object.entries(source.bins)) {
            const target = merged.bins[key] ?? { count: 0, hist: {} };
            target.count += bin.count;
            for (const [bucket, n] of Object.entries(bin.hist)) {
                target.hist[Number(bucket)] = (target.hist[Number(bucket)] ?? 0) + n;
            }
            merged.bins[key] = target;
        }
        merged.accepted += source.accepted;
        merged.rejected += source.rejected;
    }
    const firsts = [a.firstSampleAt, b.firstSampleAt].filter((v) => v !== null);
    const lasts = [a.lastSampleAt, b.lastSampleAt].filter((v) => v !== null);
    merged.firstSampleAt = firsts.length ? Math.min(...firsts) : null;
    merged.lastSampleAt = lasts.length ? Math.max(...lasts) : null;
    return merged;
}
/**
 * Build a polar from what has been measured, filling the rest from a generic
 * curve.
 *
 * A thinly-sampled node is not evidence, so it falls back rather than claiming
 * a number the boat has not earned — and the result says how much of it is
 * measured, so nothing downstream has to guess.
 */
export function derivePolar(accumulator, options = {}) {
    const { fallback = GENERIC_POLARS.cruisingMonohull, percentile = 0.9, minSamples = 30, name } = options;
    const { twaValues, twsValues } = accumulator;
    const speeds = [];
    const cells = [];
    let measuredNodes = 0;
    let sailableNodes = 0;
    for (let i = 0; i < twaValues.length; i++) {
        const row = [];
        for (let j = 0; j < twsValues.length; j++) {
            const twa = twaValues[i];
            const tws = twsValues[j];
            const bin = accumulator.bins[`${i}:${j}`];
            const count = bin?.count ?? 0;
            const measured = count >= minSamples;
            // Nodes the fallback says are unsailable — inside the pointing angle —
            // are not counted against coverage: no boat will ever fill them.
            const generic = boatSpeed(fallback, twa, tws);
            const sailable = generic > 0;
            if (sailable)
                sailableNodes++;
            if (measured && sailable)
                measuredNodes++;
            row.push(measured ? percentileOf(bin, percentile) : generic);
            cells.push({ twaDeg: twa, twsKts: tws, count, measured: measured && sailable });
        }
        speeds.push(row);
    }
    const measuredFraction = sailableNodes ? measuredNodes / sailableNodes : 0;
    const percent = Math.round(measuredFraction * 100);
    return {
        polar: {
            name: name ?? `Measured polar (${percent}% from this boat)`,
            twaValues: [...twaValues],
            twsValues: [...twsValues],
            speeds,
            // Not generic — but not wholly measured either, so the note carries the
            // caveat into every route planned with it rather than leaving the crew
            // to remember which parts were guessed.
            generic: false,
            note: percent >= 100
                ? undefined
                : `${percent}% of this polar comes from your own sailing; the rest falls back to ${fallback.name}.`
        },
        coverage: {
            cells,
            measuredFraction,
            measuredNodes,
            sailableNodes,
            accepted: accumulator.accepted,
            rejected: accumulator.rejected,
            firstSampleAt: accumulator.firstSampleAt,
            lastSampleAt: accumulator.lastSampleAt
        }
    };
}
/** Export a polar as the .pol table other routing software reads. */
export function toPolFile(polar) {
    const header = ['twa/tws', ...polar.twsValues.map(String)].join('\t');
    const rows = polar.twaValues.map((twa, i) => [String(twa), ...polar.speeds[i].map((s) => s.toFixed(2))].join('\t'));
    return [header, ...rows].join('\n');
}
/** JSON-safe form for storage or sync. */
export function serializeAccumulator(accumulator) {
    return JSON.stringify(accumulator);
}
export function deserializeAccumulator(text) {
    const parsed = JSON.parse(text);
    if (parsed?.version !== 1 || !Array.isArray(parsed.twaValues) || !parsed.bins) {
        throw new Error('That is not a polar accumulator this version can read.');
    }
    return parsed;
}
