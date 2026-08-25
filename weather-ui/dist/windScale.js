/**
 * The fleet's wind colour scale, in knots.
 *
 * One scale, because there were two. OceanSentinel's chart used these six
 * bands for its particle layer and the legend that explains them, while
 * HarborSentinel's wind arrow used a nine-step PredictWind-style ramp running
 * through fuchsia and violet. They disagreed in the middle of the range where
 * it matters most: eighteen knots read as green in one app and orange in the
 * other. Somebody running both — which is the point of a fleet — had to learn
 * two colour languages for the same fact.
 *
 * These breaks are the ones a sailboat cares about rather than even steps:
 * 5 knots is steerage, 12 is a working breeze, 20 is a reef, 28 is a gale
 * building, 36 is storm force.
 *
 * Two palettes, because these colours are drawn over both dark basemaps
 * (satellite) and light ones (ENC, streets). A single set vanishes into one of
 * them. Pick with the background the colour will actually sit on, not with the
 * app's own light/dark setting — they are not the same question, and a night
 * mode that darkens the interface does not lighten the chart underneath.
 */
export const WIND_BANDS = [
    { upTo: 5, from: 0, dark: '148, 163, 184', light: '71, 85, 105' },
    { upTo: 12, from: 5, dark: '56, 189, 248', light: '2, 132, 199' },
    { upTo: 20, from: 12, dark: '74, 222, 128', light: '22, 163, 74' },
    { upTo: 28, from: 20, dark: '250, 204, 21', light: '202, 138, 4' },
    { upTo: 36, from: 28, dark: '251, 146, 60', light: '234, 88, 12' },
    { upTo: Infinity, from: 36, dark: '248, 113, 113', light: '220, 38, 38' }
];
/** The "r, g, b" triple for a wind speed, ready to drop into an rgba() string. */
export function windBandRgb(speedKts, isLightBg) {
    const band = WIND_BANDS.find((b) => speedKts < b.upTo) ?? WIND_BANDS[WIND_BANDS.length - 1];
    return isLightBg ? band.light : band.dark;
}
/** The same thing as a finished CSS colour, for anything that just wants one. */
export function windBandColor(speedKts, isLightBg) {
    return `rgb(${windBandRgb(speedKts, isLightBg)})`;
}
/**
 * The scale as a CSS gradient, for a continuous bar rather than swatches.
 *
 * Hard stops at the band edges, deliberately. A smooth blend across them would
 * imply a continuum the scale does not have, and would put half the bar in
 * colours that mean nothing — the whole point of banding wind is that 19 knots
 * and 21 knots are different decisions, not slightly different hues.
 *
 * `maxKts` is where the bar ends; anything above the last band edge is drawn
 * in the top colour.
 */
export function windScaleGradient(maxKts = 40, isLightBg) {
    const pct = (kts) => Math.min(100, (kts / maxKts) * 100);
    const stops = [];
    for (const band of WIND_BANDS) {
        if (band.from >= maxKts)
            break;
        const colour = `rgb(${isLightBg ? band.light : band.dark})`;
        stops.push(`${colour} ${pct(band.from)}%`, `${colour} ${pct(Math.min(band.upTo, maxKts))}%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
}
/** Where the bands change, for tick marks that line up with the colours. */
export function windBandEdges(maxKts = 40) {
    return WIND_BANDS.map((b) => b.from).filter((from) => from > 0 && from < maxKts);
}
