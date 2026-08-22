/**
 * Boat performance model — the polar diagram a router optimises against.
 *
 * A polar answers one question: given a true wind angle and a true wind speed,
 * how fast does this boat go? Everything the routing engine decides follows
 * from that, which is why the polar is the single largest source of error in a
 * routed passage. A generic polar produces a plausible route; the boat's own
 * measured polar produces a useful one.
 */

export interface PolarDiagram {
  /** Human label, e.g. "Cruising monohull ~40ft (generic)". */
  name: string;
  /** True wind speeds in knots, ascending. */
  twsValues: number[];
  /** True wind angles in degrees 0-180, ascending. */
  twaValues: number[];
  /** speeds[twaIndex][twsIndex] in knots. */
  speeds: number[][];
  /**
   * True when this is an approximation rather than the vessel's own measured
   * performance, so callers can say so rather than implying precision.
   */
  generic?: boolean;
}

/** Fold any angle into 0-180: a polar is symmetric about the wind axis. */
export function foldTwa(twaDeg: number): number {
  const wrapped = ((twaDeg % 360) + 360) % 360;
  return wrapped > 180 ? 360 - wrapped : wrapped;
}

function interpolationSlot(values: number[], target: number): { lo: number; hi: number; frac: number } {
  if (target <= values[0]) return { lo: 0, hi: 0, frac: 0 };
  const last = values.length - 1;
  if (target >= values[last]) return { lo: last, hi: last, frac: 0 };
  let hi = 1;
  while (hi < last && values[hi] < target) hi++;
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
export function boatSpeed(polar: PolarDiagram, twaDeg: number, twsKts: number): number {
  const twa = foldTwa(twaDeg);
  if (!Number.isFinite(twsKts) || twsKts <= 0) return 0;

  const a = interpolationSlot(polar.twaValues, twa);
  const s = interpolationSlot(polar.twsValues, twsKts);

  const at = (ai: number, si: number) => polar.speeds[ai]?.[si] ?? 0;
  const lowAngle = at(a.lo, s.lo) + (at(a.lo, s.hi) - at(a.lo, s.lo)) * s.frac;
  const highAngle = at(a.hi, s.lo) + (at(a.hi, s.hi) - at(a.hi, s.lo)) * s.frac;
  const speed = lowAngle + (highAngle - lowAngle) * a.frac;

  return speed > 0 ? speed : 0;
}

export interface VmgResult {
  /** True wind angle giving the best velocity made good, or null if none does. */
  twaDeg: number | null;
  /** Speed made good toward (upwind) or away from (downwind) the wind, in knots. */
  vmgKts: number;
  /** Boat speed at that angle. */
  boatSpeedKts: number;
}

/**
 * Best upwind or downwind angle for a given wind strength.
 *
 * Not used by the isochrone search, which discovers these angles for itself by
 * trying every heading — it exists so a route summary can say "close hauled at
 * 42°" and so a polar can be sanity-checked after import.
 */
export function bestVmg(
  polar: PolarDiagram,
  twsKts: number,
  direction: 'upwind' | 'downwind'
): VmgResult {
  let best: VmgResult = { twaDeg: null, vmgKts: 0, boatSpeedKts: 0 };
  for (let twa = 0; twa <= 180; twa += 1) {
    const speed = boatSpeed(polar, twa, twsKts);
    if (speed <= 0) continue;
    const vmg = direction === 'upwind'
      ? speed * Math.cos((twa * Math.PI) / 180)
      : -speed * Math.cos((twa * Math.PI) / 180);
    if (vmg > best.vmgKts) best = { twaDeg: twa, vmgKts: vmg, boatSpeedKts: speed };
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
export function parsePolarFile(text: string, name = 'Imported polar'): PolarDiagram {
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

  const twaValues: number[] = [];
  const speeds: number[][] = [];
  for (const row of rows.slice(1)) {
    const twa = Number(row[0]);
    if (!Number.isFinite(twa)) continue;
    const values = row.slice(1, twsValues.length + 1).map(Number);
    if (values.some((v) => !Number.isFinite(v))) {
      throw new Error(`Polar row for ${twa}° has a value that is not a number.`);
    }
    while (values.length < twsValues.length) values.push(0);
    twaValues.push(foldTwa(twa));
    speeds.push(values);
  }

  if (!twaValues.length) {
    throw new Error('Polar file contained no usable wind angle rows.');
  }

  // Interpolation assumes ascending axes; sort rows rather than rejecting a
  // file that simply lists its angles the other way round.
  const order = twaValues.map((twa, i) => i).sort((x, y) => twaValues[x] - twaValues[y]);
  return {
    name,
    twsValues,
    twaValues: order.map((i) => twaValues[i]),
    speeds: order.map((i) => speeds[i])
  };
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
export const GENERIC_POLARS: Record<string, PolarDiagram> = {
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
