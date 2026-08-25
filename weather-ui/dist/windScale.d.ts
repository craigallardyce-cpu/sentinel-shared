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
export interface WindBand {
    /** Exclusive upper bound in knots; the top band is open-ended. */
    upTo: number;
    /** Inclusive lower bound, for a legend to label. */
    from: number;
    /** "r, g, b" for a dark background. */
    dark: string;
    /** "r, g, b" for a light one. */
    light: string;
}
export declare const WIND_BANDS: WindBand[];
/** The "r, g, b" triple for a wind speed, ready to drop into an rgba() string. */
export declare function windBandRgb(speedKts: number, isLightBg?: boolean): string;
/** The same thing as a finished CSS colour, for anything that just wants one. */
export declare function windBandColor(speedKts: number, isLightBg?: boolean): string;
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
export declare function windScaleGradient(maxKts?: number, isLightBg?: boolean): string;
/** Where the bands change, for tick marks that line up with the colours. */
export declare function windBandEdges(maxKts?: number): number[];
