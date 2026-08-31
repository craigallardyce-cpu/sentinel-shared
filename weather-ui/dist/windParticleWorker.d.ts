/**
 * The wind particle integrator, as worker source rather than a worker module.
 *
 * The algorithm is unchanged from the one that lived in OceanSentinel's
 * `utils/wind-worker.js`. What changed is how it is delivered.
 *
 * That file was loaded with `import WindWorker from './wind-worker?worker&inline'`
 * — a Vite-specific import specifier. Vite understands it; `tsc` does not, and
 * this package is built with `tsc`. Shipping the source as a string and
 * building the worker from a Blob at runtime keeps one copy of the maths for
 * the whole fleet without asking every consumer to bundle it a particular way.
 * It also works unchanged under Electron and in the Capacitor WebView, neither
 * of which is a Vite build at all.
 *
 * Kept as a template literal rather than a separate `.js` asset because a
 * package built by `tsc` copies nothing but the files it compiles: a sibling
 * `.js` would simply not be in `dist`.
 */
export declare const WIND_WORKER_SOURCE: string;
/**
 * A running particle worker, plus the Blob URL it was built from.
 *
 * The URL has to be revoked when the worker is torn down or every field change
 * leaks one for the life of the page — on a chart left running for a passage
 * that is thousands.
 */
export interface WindWorkerHandle {
    worker: Worker;
    dispose(): void;
}
/** Builds the particle worker. Returns null where Workers or Blob URLs are unavailable. */
export declare function createWindWorker(): WindWorkerHandle | null;
