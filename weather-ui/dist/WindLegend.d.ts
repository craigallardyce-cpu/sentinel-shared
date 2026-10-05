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
 *
 * Fit-and-finish fixes (2026-10-05): 12px mono capitals moved to the 13px floor, the labels to
 * sentence-case `text-label`, the unit to "kt" as the instrument cells write it, and the corner
 * to 16px, a surface floating over the chart.
 */
export default function WindLegend({ isLightBg }: WindLegendProps): import("react").JSX.Element;
