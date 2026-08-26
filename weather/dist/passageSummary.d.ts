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
    /**
     * Share of time close-hauled, reaching and running. Sums to 1.
     *
     * NULL UNDER POWER, and that is the honest answer rather than a missing
     * one. A motorboat has no points of sail: it steers the course it wants and
     * the wind angle that results is a fact about the weather, not about how the
     * vessel is being worked. Reporting "38% upwind" for a trawler would be a
     * number with no meaning behind it, and the risk is not that it looks odd —
     * it is that a reader who trusts it starts making decisions with it. What
     * replaces it is `seaAngle`, which is the question a motorboat owner was
     * actually asking.
     */
    pointOfSail: {
        upwind: number;
        reaching: number;
        downwind: number;
    } | null;
    /**
     * Share of the sea-covered time meeting the waves on the bow, on the beam
     * and from astern. Null where the marine forecast reached none of it.
     *
     * The distribution that matters to any vessel and matters most to a
     * motorboat. A metre and a half on the bow is a day of slamming, throttling
     * back and a fuel bill; the same sea from astern is a fast, rolly, cheap
     * passage. Wave height alone cannot tell those two apart, and for a
     * motorboat there is no point-of-sail figure standing in for it.
     *
     * Fractions are of the time the sea was actually known, not of the whole
     * passage, so they sum to 1 and read as "of the water we can see". Pair with
     * `seaStateCoverage` to know how much of the passage that was.
     */
    seaAngle: {
        head: number;
        beam: number;
        following: number;
    } | null;
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
    /**
     * How much of the passage is sailed in the dark, and how much of the work.
     *
     * Nobody in the comparison this came from reports either, and for a
     * short-handed crew they outrank half of what is reported instead. Hours of
     * darkness set the watch bill. Manoeuvres in the dark are the ones that go
     * wrong: a gybe at 0300 with one person awake is a different act from the
     * same gybe at noon.
     */
    night: {
        fraction: number;
        hours: number;
        manoeuvres: number;
    };
    /**
     * Wind against current, where both are real enough to matter.
     *
     * The compound metric that justifies fetching currents at all. Wind over
     * tide is where an ordinary sea stands up, shortens and breaks, and the
     * wave distribution above cannot show it — the forecast height does not know
     * the water underneath it is running the other way.
     */
    windAgainstCurrent: {
        fraction: number;
        hours: number;
    } | null;
    /**
     * How much of the passage is under power, and what it costs.
     *
     * The engine was modelled, drawn on the chart and warned about, and then
     * left out of the one artefact a skipper reads before leaving. That gap had
     * a specific edge: a passage can finish under power — motoring the last
     * stretch into a landfall is the commonest engine use there is — and a
     * synopsis that never mentions it describes a boat sailing in where it will
     * not be sailing in.
     *
     * Fuel is carried through from the route rather than recomputed, because the
     * router is what enforced the endurance limit and its arithmetic is the one
     * that decided the route. Null where the boat was never described well
     * enough to model an engine, which is not the same as a passage that sails
     * all the way — `hours: 0` says that.
     */
    motoring: {
        hours: number;
        fraction: number;
        /** Null when no fuel burn was given: hours are known, litres are not. */
        fuelLitres: number | null;
        /** The endurance the route was held to, in hours. */
        enduranceHours: number | null;
        /**
         * Usable fuel aboard, in litres — the tank less its reserve.
         *
         * Carried so the burn can be stated in its own units. "21 litres of the
         * 53 hours aboard" is two quantities in one sentence and answers neither
         * question; "21 of 160 litres" is the one a skipper is actually asking.
         */
        usableLitres: number | null;
        /**
         * Whether the passage arrives under power.
         *
         * Called out separately because it is the case a distribution hides. Two
         * hours of engine is unremarkable spread through a calm and is a different
         * fact entirely when it is the two hours that end at an unfamiliar
         * harbour entrance.
         */
        intoLandfall: boolean;
    } | null;
    /**
     * What it is like where the passage ends, which is where the risk is.
     *
     * Arriving at an unfamiliar harbour at 0300 in twenty-five knots is the real
     * hazard of most passages, and it is invisible in every average and every
     * distribution — a summary can call a passage benign and still be describing
     * one that finishes in the dark in a gale. Null for a route that never
     * arrived, because a landfall that did not happen has no conditions.
     */
    landfall: {
        atNight: boolean;
        twsKts: number;
        gustKts: number | null;
        waveHeightM: number | null;
        time: string;
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
    /**
     * The engine the route was actually given, passed straight through from the
     * router rather than restated, so the summary cannot describe a different
     * tank from the one that constrained the route.
     */
    motoring?: {
        enduranceHours?: number | null;
        fuelLitresPerHour?: number | null;
    } | null;
    /**
     * The tank, under power, passed through from the router for the same reason
     * `motoring` is: so the summary cannot describe a different tank from the
     * one that bounded the route.
     *
     * Separate from `motoring` because it means something different. That one
     * describes an auxiliary a sailing boat may or may not have used; this one
     * describes the fuel the whole passage ran on.
     */
    fuel?: {
        litresPerHour?: number | null;
        usableLitres?: number | null;
    } | null;
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
export declare function summarisePassage(route: RouteResult, options?: SummaryOptions): PassageSummary | null;
