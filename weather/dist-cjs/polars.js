"use strict";
/**
 * Boat performance model — the polar diagram a router optimises against.
 *
 * A polar answers one question: given a true wind angle and a true wind speed,
 * how fast does this boat go? Everything the routing engine decides follows
 * from that, which is why the polar is the single largest source of error in a
 * routed passage. A generic polar produces a plausible route; the boat's own
 * measured polar produces a useful one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_POLARS = void 0;
exports.foldTwa = foldTwa;
exports.boatSpeed = boatSpeed;
exports.bestVmg = bestVmg;
exports.parsePolarFile = parsePolarFile;
/** Fold any angle into 0-180: a polar is symmetric about the wind axis. */
function foldTwa(twaDeg) {
    const wrapped = ((twaDeg % 360) + 360) % 360;
    return wrapped > 180 ? 360 - wrapped : wrapped;
}
function interpolationSlot(values, target) {
    if (target <= values[0])
        return { lo: 0, hi: 0, frac: 0 };
    const last = values.length - 1;
    if (target >= values[last])
        return { lo: last, hi: last, frac: 0 };
    let hi = 1;
    while (hi < last && values[hi] < target)
        hi++;
    const lo = hi - 1;
    const span = values[hi] - values[lo];
    return { lo, hi, frac: span === 0 ? 0 : (target - values[lo]) / span };
}
/**
 * Boat speed in knots for a wind angle and strength, bilinearly interpolated.
 *
 * Wind stronger than the polar describes is clamped to its top row rather than
 * extrapolated: beyond the last measured column a boat is reefing, and a curve
 * fitted upward there would promise speed that reefed sail cannot deliver.
 */
function boatSpeed(polar, twaDeg, twsKts) {
    const twa = foldTwa(twaDeg);
    if (!Number.isFinite(twsKts) || twsKts <= 0)
        return 0;
    const a = interpolationSlot(polar.twaValues, twa);
    const s = interpolationSlot(polar.twsValues, twsKts);
    const at = (ai, si) => polar.speeds[ai]?.[si] ?? 0;
    const lowAngle = at(a.lo, s.lo) + (at(a.lo, s.hi) - at(a.lo, s.lo)) * s.frac;
    const highAngle = at(a.hi, s.lo) + (at(a.hi, s.hi) - at(a.hi, s.lo)) * s.frac;
    let speed = lowAngle + (highAngle - lowAngle) * a.frac;
    /**
     * Below the polar's lightest wind, ramp to zero instead of clamping.
     *
     * Every polar stops somewhere at the bottom — the generic ones here start at
     * 6 knots, and published ones rarely go below 4, because nobody measures a
     * boat in a drifter. `interpolationSlot` clamps outside the table, which for
     * the top of the range is defensible and for the bottom was not: it meant
     * that in a tenth of a knot of wind this returned the full six-knot-column
     * speed. The boat sailed a flat calm at 5.3 knots.
     *
     * That was not a rounding error, it was load-bearing. The isochrone router
     * decides whether to start the engine by asking what the sails could make
     * good, so a boat that "sails" at 5.3 knots in a calm never motors — the
     * engine sat idle through exactly the conditions it exists for, and a
     * passage with twelve hours of calm in it was planned as though those hours
     * were sailed at hull speed. Both the ETA and the fuel figure were fiction.
     *
     * Linear to the origin is the honest minimum. It is not a real light-air
     * model — real boats have a threshold below which they will not steer at
     * all, and drift with the current instead — but it is monotonic, it is
     * conservative in the right direction, and it makes a calm behave like a
     * calm. Anything better needs measurements that the boat itself can supply
     * through the learned polar.
     */
    const lightest = polar.twsValues[0];
    if (Number.isFinite(lightest) && lightest > 0 && twsKts < lightest) {
        speed *= twsKts / lightest;
    }
    return speed > 0 ? speed : 0;
}
/**
 * Best upwind or downwind angle for a given wind strength.
 *
 * Not used by the isochrone search, which discovers these angles for itself by
 * trying every heading — it exists so a route summary can say "close hauled at
 * 42°" and so a polar can be sanity-checked after import.
 */
function bestVmg(polar, twsKts, direction) {
    let best = { twaDeg: null, vmgKts: 0, boatSpeedKts: 0 };
    for (let twa = 0; twa <= 180; twa += 1) {
        const speed = boatSpeed(polar, twa, twsKts);
        if (speed <= 0)
            continue;
        const vmg = direction === 'upwind'
            ? speed * Math.cos((twa * Math.PI) / 180)
            : -speed * Math.cos((twa * Math.PI) / 180);
        if (vmg > best.vmgKts)
            best = { twaDeg: twa, vmgKts: vmg, boatSpeedKts: speed };
    }
    return best;
}
/**
 * Parse the .pol / .csv table used by most routing software: a header row of
 * true wind speeds, then one row per true wind angle.
 *
 *   twa/tws  6    8    10
 *   40       3.8  4.6  5.2
 *   60       4.9  5.8  6.4
 *
 * Tabs, semicolons, commas or runs of spaces all separate columns, because
 * exports in the wild use all four.
 */
function parsePolarFile(text, name = 'Imported polar') {
    const rows = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => line.split(/[\t;,]|\s{1,}/).filter((cell) => cell.length > 0));
    if (rows.length < 2) {
        throw new Error('Polar file needs a wind speed header row and at least one wind angle row.');
    }
    // The header's first cell is a label like "twa/tws" in most exports, but is
    // occasionally a bare 0. Treat a leading non-numeric cell as the label.
    const header = rows[0];
    const headerStart = Number.isFinite(Number(header[0])) && header.length > 1 ? 1 : 1;
    const twsValues = header.slice(headerStart).map(Number);
    if (!twsValues.length || twsValues.some((v) => !Number.isFinite(v))) {
        throw new Error('Could not read true wind speeds from the polar header row.');
    }
    const twaValues = [];
    const speeds = [];
    for (const row of rows.slice(1)) {
        const twa = Number(row[0]);
        if (!Number.isFinite(twa))
            continue;
        const values = row.slice(1, twsValues.length + 1).map(Number);
        if (values.some((v) => !Number.isFinite(v))) {
            throw new Error(`Polar row for ${twa}° has a value that is not a number.`);
        }
        while (values.length < twsValues.length)
            values.push(0);
        twaValues.push(foldTwa(twa));
        speeds.push(values);
    }
    if (!twaValues.length) {
        throw new Error('Polar file contained no usable wind angle rows.');
    }
    // Interpolation assumes ascending axes; sort rows rather than rejecting a
    // file that simply lists its angles the other way round.
    const order = twaValues.map((twa, i) => i).sort((x, y) => twaValues[x] - twaValues[y]);
    const sortedTwa = order.map((i) => twaValues[i]);
    const sortedSpeeds = order.map((i) => speeds[i]);
    // Close the upwind end. A .pol file starts at the boat's pointing angle —
    // 52 degrees is typical — because there is nothing to record closer than
    // that. But the interpolator clamps below its lowest angle, so without a zero
    // row the file claims the boat makes its close-hauled speed dead upwind, and
    // a router reading it sails straight at the wind and never tacks. The generic
    // and learned diagrams both carry an explicit zero row for this reason; an
    // imported one has to be given the same.
    //
    // The downwind end is left alone. Clamping a file that stops at 150 degrees
    // to its 150-degree speed at 180 is optimistic, but a boat does sail dead
    // downwind — inventing a slower number there would be making data up, while
    // the zero row upwind is only writing down what the file already means.
    // The zero row goes just inside the pointing angle rather than only at 0, the
    // same way the generic diagrams place theirs: a single zero at 0 would ramp
    // linearly all the way up to the first real row, so a boat whose file starts
    // at 52 would appear to point at 49. Five degrees keeps the no-sail zone
    // where the file says it is.
    const NO_SAIL_MARGIN_DEG = 5;
    if (sortedTwa[0] > 0) {
        const zeros = () => twsValues.map(() => 0);
        const edge = sortedTwa[0] - NO_SAIL_MARGIN_DEG;
        if (edge > 0) {
            sortedTwa.unshift(edge);
            sortedSpeeds.unshift(zeros());
        }
        sortedTwa.unshift(0);
        sortedSpeeds.unshift(zeros());
    }
    return { name, twsValues, twaValues: sortedTwa, speeds: sortedSpeeds };
}
const TWS = [6, 8, 10, 12, 14, 16, 20, 25];
const TWA = [0, 35, 40, 50, 60, 75, 90, 110, 120, 135, 150, 165, 180];
/**
 * Generic polars, for planning before a boat's own numbers exist.
 *
 * These are shape-plausible approximations for their type, not measurements of
 * any particular hull. They are good enough to compare one departure time
 * against another — which is most of what routing is for — and not good enough
 * to promise an ETA. Rows below the type's pointing angle are zero, so the
 * router tacks rather than pretending a boat sails into the wind.
 */
exports.GENERIC_POLARS = {
    cruisingMonohull: {
        name: 'Cruising monohull ~40ft (generic)',
        generic: true,
        twsValues: TWS,
        twaValues: TWA,
        speeds: [
            [0, 0, 0, 0, 0, 0, 0, 0], // 0
            [0, 0, 0, 0, 0, 0, 0, 0], // 35 — inside the pointing angle
            [3.8, 4.6, 5.2, 5.5, 5.7, 5.8, 5.9, 5.7], // 40
            [4.5, 5.4, 6.0, 6.3, 6.5, 6.6, 6.7, 6.5], // 50
            [4.9, 5.8, 6.4, 6.8, 7.0, 7.1, 7.3, 7.1], // 60
            [5.2, 6.1, 6.7, 7.1, 7.3, 7.5, 7.7, 7.6], // 75
            [5.3, 6.2, 6.8, 7.2, 7.5, 7.7, 8.0, 8.0], // 90
            [5.1, 6.0, 6.7, 7.1, 7.4, 7.7, 8.2, 8.4], // 110
            [4.9, 5.8, 6.5, 6.9, 7.3, 7.6, 8.2, 8.6], // 120
            [4.4, 5.3, 6.0, 6.5, 6.9, 7.2, 7.9, 8.4], // 135
            [3.9, 4.7, 5.4, 5.9, 6.3, 6.6, 7.3, 7.9], // 150
            [3.5, 4.2, 4.9, 5.4, 5.8, 6.1, 6.8, 7.4], // 165
            [3.2, 3.9, 4.5, 5.0, 5.4, 5.7, 6.4, 7.0] // 180
        ]
    },
    performanceMonohull: {
        name: 'Performance monohull ~45ft (generic)',
        generic: true,
        twsValues: TWS,
        twaValues: TWA,
        speeds: [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [4.2, 5.1, 5.8, 6.2, 6.4, 6.5, 6.6, 6.4], // points higher than a cruiser
            [4.8, 5.8, 6.5, 6.9, 7.1, 7.3, 7.4, 7.2],
            [5.5, 6.6, 7.2, 7.6, 7.9, 8.0, 8.2, 8.0],
            [6.0, 7.0, 7.7, 8.1, 8.4, 8.6, 8.8, 8.7],
            [6.3, 7.3, 8.0, 8.5, 8.8, 9.1, 9.5, 9.6],
            [6.4, 7.4, 8.2, 8.7, 9.1, 9.5, 10.1, 10.5],
            [6.2, 7.3, 8.1, 8.7, 9.2, 9.7, 10.7, 11.6],
            [6.0, 7.1, 7.9, 8.5, 9.1, 9.6, 10.8, 12.0],
            [5.4, 6.5, 7.3, 8.0, 8.6, 9.1, 10.4, 11.8],
            [4.8, 5.8, 6.6, 7.2, 7.8, 8.3, 9.5, 10.9],
            [4.3, 5.2, 6.0, 6.6, 7.1, 7.6, 8.8, 10.1],
            [4.0, 4.8, 5.6, 6.2, 6.7, 7.1, 8.3, 9.5]
        ]
    },
    cruisingCatamaran: {
        name: 'Cruising catamaran ~42ft (generic)',
        generic: true,
        twsValues: TWS,
        twaValues: TWA,
        speeds: [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0], // 40 — a cruising cat will not hold this angle
            [4.2, 5.2, 6.0, 6.4, 6.7, 6.9, 7.0, 6.8], // 50
            [5.0, 6.1, 6.9, 7.4, 7.7, 7.9, 8.1, 7.9],
            [5.6, 6.8, 7.7, 8.3, 8.7, 9.0, 9.3, 9.2],
            [5.8, 7.0, 8.0, 8.6, 9.1, 9.4, 9.9, 10.0],
            [5.5, 6.7, 7.7, 8.4, 8.9, 9.4, 10.1, 10.5],
            [5.2, 6.4, 7.4, 8.1, 8.6, 9.1, 10.0, 10.6],
            [4.6, 5.7, 6.6, 7.3, 7.9, 8.4, 9.3, 10.1],
            [4.0, 4.9, 5.8, 6.4, 7.0, 7.5, 8.4, 9.2],
            [3.6, 4.4, 5.2, 5.8, 6.3, 6.8, 7.7, 8.5],
            [3.3, 4.1, 4.8, 5.4, 5.9, 6.3, 7.2, 8.0]
        ]
    }
};
