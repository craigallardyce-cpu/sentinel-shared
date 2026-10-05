import { WIND_BANDS } from './windScale';

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
export default function WindLegend({ isLightBg }: WindLegendProps) {
  return (
    <div className="glass-panel rounded-xl px-3 py-2 flex items-center gap-2 select-none pointer-events-none">
      <span className="text-label text-text-muted">Wind</span>
      <div className="flex items-end gap-px">
        {WIND_BANDS.map((band) => (
          <div key={band.from} className="flex flex-col items-center gap-1">
            <span
              className="block w-6 sm:w-7 h-1.5 rounded-[1px]"
              style={{ backgroundColor: `rgb(${isLightBg ? band.light : band.dark})` }}
            />
            <span className="font-mono text-[13px] font-medium text-text-muted leading-none">{band.from}</span>
          </div>
        ))}
      </div>
      <span className="text-label text-text-muted">kt</span>
    </div>
  );
}
