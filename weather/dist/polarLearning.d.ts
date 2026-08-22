import { type PolarDiagram } from './polars.js';
export interface PolarBin {
    /** Accepted samples at this node. */
    count: number;
    /** Speed bucket index -> how many samples landed in it. Sparse. */
    hist: Record<number, number>;
}
export interface PolarAccumulator {
    version: 1;
    /** True wind angles, degrees, ascending — the grid samples are binned onto. */
    twaValues: number[];
    /** True wind speeds, knots, ascending. */
    twsValues: number[];
    /** "twaIndex:twsIndex" -> bin. Sparse: unsailed conditions cost nothing. */
    bins: Record<string, PolarBin>;
    accepted: number;
    rejected: number;
    /**
     * Why samples were refused, by reason. The point of keeping this is
     * diagnostic: a boat whose polar is not filling in should be able to see
     * that every sample is being thrown away as motoring because the RPM sensor
     * reads 600 at idle, rather than concluding the feature is broken.
     */
    rejections: Partial<Record<RejectionReason, number>>;
    firstSampleAt: number | null;
    lastSampleAt: number | null;
}
export interface TelemetrySample {
    /** Epoch ms. */
    t: number;
    /** Speed through water, knots. Boat speed over ground is contaminated by current. */
    stw: number;
    /** True wind speed, knots. */
    tws: number;
    /** True wind direction, degrees the wind comes FROM. */
    twd: number;
    /** Vessel heading, degrees true. */
    heading: number;
    /** Engine revolutions, when known. Motoring is not sailing. */
    engineRpm?: number;
}
export type RejectionReason = 'incomplete' | 'implausible' | 'motoring' | 'becalmed' | 'not-moving' | 'manoeuvring' | 'wind-unsettled';
export interface AddSampleResult {
    accepted: boolean;
    reason?: RejectionReason;
    twaDeg?: number;
}
export interface LearningOptions {
    /** Engine revolutions above which the boat counts as motoring. Default 400. */
    motoringRpm?: number;
    /** Ignore samples in less wind than this. Default 2 kt. */
    minTwsKts?: number;
    /** Ignore samples slower than this. Default 0.3 kt. */
    minStwKts?: number;
    /**
     * Reject a sample if the heading moved more than this since the last one.
     * A boat mid-tack is not sailing its polar. Default 12°.
     */
    maxHeadingChangeDeg?: number;
    /**
     * Reject if the true wind speed jumped more than this since the last sample —
     * a gust front or an instrument spike, either way not a steady state.
     * Default 6 kt.
     */
    maxTwsChangeKts?: number;
    /** Samples further apart than this are not compared for steadiness. Default 60 s. */
    steadyWindowMs?: number;
}
export declare function createPolarAccumulator(twaValues?: number[], twsValues?: number[]): PolarAccumulator;
/** True wind angle from the wind's direction and the boat's heading. */
export declare function trueWindAngle(twdDeg: number, headingDeg: number): number;
/**
 * Offer one telemetry sample to the polar.
 *
 * Returns why a sample was refused rather than silently dropping it: a boat
 * whose polar is not filling in should be able to find out that every sample
 * is being rejected as motoring because its RPM sensor reads 600 at idle.
 */
export declare function addSample(accumulator: PolarAccumulator, sample: TelemetrySample, options?: LearningOptions): AddSampleResult;
/** Add one accumulator into another — two devices, two halves of a season. */
export declare function mergeAccumulators(a: PolarAccumulator, b: PolarAccumulator): PolarAccumulator;
export interface CoverageCell {
    twaDeg: number;
    twsKts: number;
    count: number;
    measured: boolean;
}
export interface PolarCoverage {
    cells: CoverageCell[];
    /** Nodes with enough samples to be trusted, over nodes a boat could sail. */
    measuredFraction: number;
    measuredNodes: number;
    /** Nodes inside the pointing angle are excluded: no boat fills them. */
    sailableNodes: number;
    accepted: number;
    rejected: number;
    /** Why samples were refused — the diagnostic behind an empty polar. */
    rejections: Partial<Record<RejectionReason, number>>;
    firstSampleAt: number | null;
    lastSampleAt: number | null;
}
export interface DeriveOptions {
    /** Curve used where the boat has not sailed enough. Default cruising monohull. */
    fallback?: PolarDiagram;
    /** Where in a bin's speed distribution to read the polar. Default 0.9. */
    percentile?: number;
    /** Samples a node needs before it is trusted. Default 30 (five minutes). */
    minSamples?: number;
    /** Name for the derived diagram. */
    name?: string;
}
export interface DerivedPolar {
    polar: PolarDiagram;
    coverage: PolarCoverage;
}
/**
 * Build a polar from what has been measured, filling the rest from a generic
 * curve.
 *
 * A thinly-sampled node is not evidence, so it falls back rather than claiming
 * a number the boat has not earned — and the result says how much of it is
 * measured, so nothing downstream has to guess.
 */
export declare function derivePolar(accumulator: PolarAccumulator, options?: DeriveOptions): DerivedPolar;
/** Export a polar as the .pol table other routing software reads. */
export declare function toPolFile(polar: PolarDiagram): string;
/** JSON-safe form for storage or sync. */
export declare function serializeAccumulator(accumulator: PolarAccumulator): string;
export declare function deserializeAccumulator(text: string): PolarAccumulator;
