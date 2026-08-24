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
/**
 * How far apart two ETAs may sit before it is worth saying so.
 *
 * Three hours on a passage of days is inside the noise of a polar and a
 * skipper's own sail changes; past that the models are telling different
 * stories about the weather and the ranking of departures stops being safe to
 * lean on.
 */
const MATERIAL_HOURS = 3;
const earliest = (outcomes) => {
    let best = null;
    for (const o of outcomes) {
        if (!o.reached)
            continue;
        // Arrival time, not passage length: the question is who gets there first.
        if (!best || o.key + o.etaHours < best.key + best.etaHours)
            best = o;
    }
    return best;
};
const hours = (n) => {
    const rounded = Math.round(Math.abs(n) * 10) / 10;
    return rounded >= 1 ? `${Math.round(rounded)}h` : `${Math.round(rounded * 60)} min`;
};
/**
 * Compare a second model's routing of the same departures against the first.
 *
 * Returns null when there is nothing worth saying — no second model, or it
 * produced no usable passage at all, which is a gap in coverage rather than a
 * disagreement about the weather.
 */
export function compareSecondOpinion(primary, second, model, modelLabel = model) {
    if (!primary?.length || !second?.length)
        return null;
    const primaryBest = earliest(primary);
    const secondBest = earliest(second);
    if (!primaryBest)
        return null; // The primary found nothing; nothing to second-guess.
    const secondForPrimaryPick = second.find((o) => o.key === primaryBest.key);
    // The second model cannot get the recommended departure in at all. That is
    // the strongest disagreement available and deserves saying plainly.
    if (!secondForPrimaryPick?.reached) {
        return {
            model,
            agrees: false,
            primaryBest: primaryBest.key,
            secondBest: secondBest ? secondBest.key : null,
            etaDeltaHours: null,
            summary: `${modelLabel} does not get this passage in on the recommended departure at all. ` +
                'The two models disagree about this forecast — treat the plan as provisional and look again nearer the time.'
        };
    }
    const delta = secondForPrimaryPick.etaHours - primaryBest.etaHours;
    const sameBest = secondBest !== null && secondBest.key === primaryBest.key;
    const material = Math.abs(delta) >= MATERIAL_HOURS;
    if (sameBest && !material) {
        return {
            model,
            agrees: true,
            primaryBest: primaryBest.key,
            secondBest: secondBest.key,
            etaDeltaHours: delta,
            summary: `${modelLabel} agrees: same departure, and its arrival is within ${hours(delta)} of this one.`
        };
    }
    if (sameBest) {
        return {
            model,
            agrees: false,
            primaryBest: primaryBest.key,
            secondBest: secondBest.key,
            etaDeltaHours: delta,
            summary: `${modelLabel} picks the same departure but puts the arrival ${hours(delta)} ` +
                `${delta > 0 ? 'later' : 'earlier'}. The timing is less settled than one model makes it look.`
        };
    }
    return {
        model,
        agrees: false,
        primaryBest: primaryBest.key,
        secondBest: secondBest ? secondBest.key : null,
        etaDeltaHours: delta,
        summary: `${modelLabel} would leave on a different departure, and puts this one ${hours(delta)} ` +
            `${delta > 0 ? 'later' : 'earlier'}. The models disagree about which window is best — ` +
            'the ranking is not worth leaning on yet.'
    };
}
