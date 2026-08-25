import type { RouteResult } from './routing.js';
/**
 * What a passage is actually like, as distributions rather than extremes.
 *
 * A route already knows the wind, the sea and the angle it was sailed at for
 * every hour of it, and until now all of that was thrown away except the
 * worst value. That loses the only question a skipper is really asking. "Worst
 * seas 3 m" is produced identically by a passage that touches 3 m for twenty
 * minutes and one that spends two days in it, and those are not the same
 * passage.
 *
 * So everything here is time-weighted. The unit is hours spent, not legs
 * counted: the final leg into a destination is usually a fraction of a step,
 * and counting it equally with a full hour would quietly overweight the
 * landfall conditions in every summary.
 *
 * Nothing in here is a new claim about the world. It is the same forecast the
 * route was computed from, reported at the resolution the decision needs — so
 * it inherits the route's warnings and adds none of its own.
 */
/** One bucket of a distribution: how long the passage spent in it. */
export interface Band {
    /** Inclusive lower bound of the band, in the distribution's own units. */
    from: number;
    /** Exclusive upper bound, or null for the open-ended top band. */
    to: number | null;
    label: string;
    hours: number;
    /** Share of the covered passage, 0-1. */
    fraction: number;
}
export interface PassageSummary {
    /** Hours the summary covers — the passage minus its zero-length first leg. */
    hours: number;
    wind: {
        minKts: number;
        maxKts: number;
        /** Time-weighted mean, not the mean of the legs. */
        meanKts: number;
        /** Worst gust anywhere on the passage, where the model published gusts. */
        maxGustKts: number | null;
    };
    /** Share of time close-hauled, reaching and running. Sums to 1. */
    pointOfSail: {
        upwind: number;
        reaching: number;
        downwind: number;
    };
    windBands: Band[];
    waveBands: Band[];
    /**
     * Share of the passage spent hard on the wind in a real breeze.
     *
     * The single most useful compound number in a passage summary. Upwind is
     * tolerable and breeze is tolerable; it is the two together that soaks the
     * boat, stops anyone sleeping and makes crews swear off passage-making.
     * Neither of the distributions above can show it, because it lives in the
     * overlap between them.
     */
    hardUpwind: {
        fraction: number;
        hours: number;
        thresholdKts: number;
        twaDeg: number;
    };
    /**
     * Share of the passage the marine forecast actually reached, 0-1.
     *
     * Reported as a share rather than a yes/no, because partial coverage is the
     * normal case — the marine models run out both further ahead in time and
     * closer in to a coast than the atmospheric ones. A wave distribution over
     * 60% of a passage is worth having and worth labelling; one presented as if
     * it covered all of it is not.
     */
    seaStateCoverage: number;
    /**
     * How much of the passage the sea arrives in step with the boat's own roll,
     * or null when no roll period was given.
     *
     * This is the honest half of what a seakeeping model would tell you. Real
     * RMS roll and vertical acceleration come from a hull model — dimensions,
     * displacement, metacentric height — that this app does not have and should
     * not guess at. But resonance needs only one number, and it is a number the
     * owner can MEASURE rather than one anybody has to infer: rock the boat at
     * the dock, time several full rolls, divide. That is the same bargain the
     * learned polar strikes, and it is why this reports resonance rather than
     * degrees of roll it cannot know.
     *
     * Resonant rolling is also the thing that actually ruins a passage. A boat
     * can be perfectly safe and completely miserable, and this is usually why.
     */
    rollResonance: {
        fraction: number;
        hours: number;
        rollPeriodS: number;
        /** Hours the encounter period could not be computed — running with the sea. */
        unknownHours: number;
    } | null;
}
export interface SummaryOptions {
    /**
     * The boat's natural roll period in seconds, measured rather than modelled.
     * Omit and no resonance is reported, which is the right outcome: a guessed
     * roll period would produce a confident answer about the one thing here that
     * a skipper would actually change plans over.
     */
    rollPeriodS?: number | null;
}
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
export declare function encounterPeriodS(wavePeriodS: number, waveAngleDeg: number, boatSpeedKts: number): number | null;
/**
 * Wind bands, in knots.
 *
 * Chosen around what a cruising boat does rather than around round numbers: 8
 * is roughly where a cruiser stops sailing and starts motoring, 20 is the
 * first reef, 30 is the second and the point where a passage becomes work, 40
 * is heavy weather.
 */
export declare const WIND_BANDS_KTS: number[];
/**
 * Sea bands, in metres.
 *
 * Whole metres of significant wave height. Finer bands would imply the models
 * resolve sea state better than they do, and a cruiser's decisions do not turn
 * on half a metre at these heights anyway.
 */
export declare const WAVE_BANDS_M: number[];
/**
 * Summarise a computed route.
 *
 * Returns null for a route with nothing to summarise — one that never left the
 * departure point. That is a real outcome (a start inside an obstacle, a sea
 * above the limit set, a flat calm) and the route's own warnings already
 * explain it far better than an all-zero summary would.
 */
export declare function summarisePassage(route: RouteResult, options?: SummaryOptions): PassageSummary | null;
