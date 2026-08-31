/**
 * The shape of a wind field, as the chart layers read it.
 *
 * Declared structurally rather than imported from `@sentinel/weather` on
 * purpose: the canvas layer, the legend and the worker need only the axes and
 * the two vector components, and typing them against the router's full
 * `WindField` would drag a data-fetching package into everything that merely
 * draws. A real `WindField` satisfies this, so callers can pass one straight in.
 */
export interface WindFieldLike {
  /** Ascending, south to north. */
  lats: number[];
  /** Ascending, west to east. */
  lons: number[];
  /** Epoch ms for each forecast hour. */
  times: number[];
  /** u[timeIndex][latIndex][lonIndex] — eastward component, knots. */
  u: number[][][];
  /** v[timeIndex][latIndex][lonIndex] — northward component, knots. */
  v: number[][][];
}

/**
 * The field's axes as 2D arrays, which is the shape the worker's interpolator
 * reads. Built once per field by `useWindField` rather than per frame.
 */
export interface WindFieldAxes {
  latGrid: number[][];
  lonGrid: number[][];
}

/** A degrees bounding box, in the worker's own naming. */
export interface WindGridBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** How a layer reads underneath, so the particles pick a palette that survives it. */
export type ChartBackground = 'light' | 'dark' | 'transparent';
