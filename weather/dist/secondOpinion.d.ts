/**
 * Two forecast models, compared.
 *
 * A routed passage looks authoritative — a table of departures, arrival times
 * to the minute, one of them marked "arrives first". All of it rests on one
 * model's guess about next week's wind, and the honest question a skipper
 * wants answered is not "what does the forecast say" but "how much should I
 * believe it". Running the same passage against a second, independent model
 * answers that in the only terms that matter: does it pick the same departure,
 * and does it agree about when you get there.
 *
 * Agreement is not accuracy. Two models can be wrong together, and often are
 * beyond a few days out. What disagreement tells you is firmer than what
 * agreement tells you: when they diverge, the forecast is not yet worth
 * planning around, and the wording here leans on that asymmetry rather than
 * dressing agreement up as confidence.
 */
/** One departure's outcome, from whichever model produced it. */
export interface DepartureOutcome {
    /** Whatever identifies this departure to the caller — an offset, an index. */
    key: number;
    reached: boolean;
    etaHours: number;
}
export interface SecondOpinion {
    /** The model that gave the second view, as Open-Meteo names it. */
    model: string;
    /** True when it picks the same departure AND lands close on the timing. */
    agrees: boolean;
    /** Both models' pick for earliest arrival, or null where one never arrives. */
    primaryBest: number | null;
    secondBest: number | null;
    /** Hours the second model puts the primary's pick behind (negative: ahead). */
    etaDeltaHours: number | null;
    /** One sentence for the planner to show. */
    summary: string;
}
/**
 * Compare a second model's routing of the same departures against the first.
 *
 * Returns null when there is nothing worth saying — no second model, or it
 * produced no usable passage at all, which is a gap in coverage rather than a
 * disagreement about the weather.
 */
export declare function compareSecondOpinion(primary: DepartureOutcome[], second: DepartureOutcome[], model: string, modelLabel?: string): SecondOpinion | null;
