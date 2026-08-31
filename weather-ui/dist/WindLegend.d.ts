export interface WindLegendProps {
    /**
     * Whether the chart underneath is light.
     *
     * Must be the same answer the particles were drawn with — a key that disagrees with the
     * thing it explains is worse than no key at all. Callers derive it the same way the canvas
     * layer does: `!isNightMode && chartBackground === 'light'`.
     */
    isLightBg?: boolean;
}
/**
 * The key to the wind field's colours.
 *
 * The particles carry speed in their colour and nothing on a chart says so — green and orange
 * streams read as decoration until you know that one is a working breeze and the other is a
 * reef. Shown only while the wind overlay is on, and it takes the same palette the particles
 * do, so a light chart gets the darker set.
 */
export default function WindLegend({ isLightBg }: WindLegendProps): import("react").JSX.Element;
