import React from 'react';
import { Wind } from 'lucide-react';
import { motion } from 'motion/react';
import { getWindRotation, getHighestWindValue, formatTempRangeString } from './weatherUtils';
import { windBandColor } from './windScale';
import { nwsSentenceCase } from './nwsText';

export interface ForecastPeriod {
  periodName: string;
  windRange: string;
  windDirection?: string;
  tempRange?: string;
  precipChance?: string;
  reason?: string;
  riskLevel?: string;
  startTime?: string;
  endTime?: string;
}

export interface ForecastTimelineProps {
  periods: ForecastPeriod[];
  tempUnit: string;
  mode?: 'sidebar' | 'bulletin';
  theme?: {
    /** Sidebar card: surface, border, radius and padding. */
    cardBgBorder?: string;
    /** Bulletin card: surface and border colours (radius and padding are fixed). */
    bulletinCardBgBorder?: string;
    windIconClass?: string;
    textMutedClass?: string;
    textPrimaryClass?: string;
    textSecondaryClass?: string;
    textOrangeClass?: string;
    textCyanClass?: string;
    /**
     * @deprecated Ignored (fit-and-finish fixes, 2026-10-05). The bulletin card
     * is one surface: the inner box this coloured was a card inside a card.
     */
    gridBgClass?: string;
    borderDividerClass?: string;
  };
}

/*
  The forecast, as cards (bulletin) or as a compact list of the next four
  periods (sidebar).

  Fit-and-finish (2026-09-30) never reached this component, and the catalogue
  re-shoot found it still in the old house style: mono capitals for every label
  and for the NWS prose, a 12px description, and a card inside each card. It
  follows the system now:

    - period title   Inter 20/600 (bulletin) or 15/600 (sidebar), as written;
    - field label    `text-label`, Inter 13/600, sentence case, muted;
    - value          `text-data-mono-lg`, JetBrains Mono 15/500;
    - NWS prose      Inter 15/400, in sentence case (see nwsText.ts), with the
                     original text in its `title`;
    - card           one surface at the full width it is given, 16px radius,
                     no shadow and no inner box.

  "Max wind (incl. gusts)" wrapped onto two lines in a quarter-width column at
  1280px, so the label is "Max wind" and "incl. gusts" sits under the value:
  the fact stays on screen, and the label stays one line at every width.
*/

const LABEL = 'text-label whitespace-nowrap';
const VALUE = 'text-data-mono-lg';

/** One label/value pair in the bulletin card's grid. */
function Field({
  label,
  value,
  note,
  mutedClass,
  primaryClass,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  mutedClass: string;
  primaryClass: string;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0" data-slot="forecast-field">
      <dt className={`${LABEL} ${mutedClass}`}>{label}</dt>
      <dd className={`${VALUE} ${primaryClass}`}>
        {value}
        {note && <span className={`block font-sans text-body-sm ${mutedClass}`}>{note}</span>}
      </dd>
    </div>
  );
}

export default function ForecastTimeline({
  periods,
  tempUnit,
  mode = 'sidebar',
  theme
}: ForecastTimelineProps) {
  if (!periods || periods.length === 0) return null;

  // OceanSentinel's styles as defaults.
  const cardBgBorder = theme?.cardBgBorder || 'p-3 rounded-md border bg-bg-card/60 border-border-color/30';
  const bulletinCardBgBorder = theme?.bulletinCardBgBorder || 'bg-bg-card border-border-color/30';
  const windIconClass = theme?.windIconClass || 'text-cyan';
  const textMutedClass = theme?.textMutedClass || 'text-text-muted';
  const textPrimaryClass = theme?.textPrimaryClass || 'text-text-primary';
  const textSecondaryClass = theme?.textSecondaryClass || 'text-text-secondary';
  const textOrangeClass = theme?.textOrangeClass || 'text-orange';
  const textCyanClass = theme?.textCyanClass || 'text-cyan/80';
  const borderDividerClass = theme?.borderDividerClass || 'border-border-color/20';

  if (mode === 'bulletin') {
    return (
      <div className="flex flex-col gap-4 w-full" data-slot="forecast-bulletin">
        {periods.map((period, i) => (
          <motion.section
            key={i}
            /* A surface entering: 200ms on the fleet curve, and a short rise. */
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1], delay: Math.min(i, 6) * 0.04 }}
            aria-label={period.periodName}
            className={`w-full p-4 sm:p-6 rounded-xl border text-left ${bulletinCardBgBorder}`}
            data-slot="forecast-card"
          >
            <h3 className={`text-headline-md ${textPrimaryClass}`}>{period.periodName}</h3>

            <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
              <Field label="Max wind" value={period.windRange} note="incl. gusts" mutedClass={textMutedClass} primaryClass={textPrimaryClass} />
              <Field label="Direction" value={period.windDirection || 'Variable'} mutedClass={textMutedClass} primaryClass={textPrimaryClass} />
              <Field label="Temperature" value={formatTempRangeString(period.tempRange, tempUnit)} mutedClass={textMutedClass} primaryClass={textPrimaryClass} />
              <Field label="Precipitation" value={period.precipChance || 'None'} mutedClass={textMutedClass} primaryClass={textPrimaryClass} />
            </dl>

            {period.reason && (
              <p className={`mt-4 text-body-md ${textSecondaryClass}`} title={period.reason} data-slot="forecast-text">
                {nwsSentenceCase(period.reason)}
              </p>
            )}
          </motion.section>
        ))}
      </div>
    );
  }

  // Sidebar: the next four periods, compact.
  return (
    <div className="grid grid-cols-1 gap-2 w-full">
      {periods.slice(0, 4).map((p, idx) => (
        <div key={idx} className={`flex flex-col gap-1.5 text-left ${cardBgBorder}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col min-w-0">
              <span className={`font-sans text-[15px] font-semibold leading-[22px] ${textPrimaryClass}`}>{p.periodName}</span>
              <div className="flex items-center gap-1.5">
                <Wind size={16} strokeWidth={1.75} aria-hidden className={`shrink-0 ${windIconClass}`} />
                <span className={`${VALUE} ${textPrimaryClass}`}>{p.windRange}</span>
              </div>
            </div>
            {p.windDirection && (
              <div className="flex flex-col items-end shrink-0">
                <span className={`${LABEL} ${textMutedClass}`}>Direction</span>
                <div className="flex items-center gap-1.5">
                  <span className={`${VALUE} ${textSecondaryClass}`}>{p.windDirection}</span>
                  <div
                    style={{ transform: `rotate(${getWindRotation(p.windDirection)}deg)`, transformOrigin: 'center' }}
                    className="transition-transform duration-500 ease-out flex items-center justify-center w-4 h-4"
                    title={`Wind from ${p.windDirection}`}
                  >
                    {/* `wind-band-arrow` is the hook night mode needs. The stroke
                        here is a wind-band colour computed in JS, so it is a
                        presentation attribute rather than a token-driven class and
                        `.theme-night` cannot reach it — which left a green or blue
                        arrow on every forecast row at 0300. @sentinel/theme's
                        night.css overrides this class to the alarm red. */}
                    <svg className="wind-band-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={windBandColor(getHighestWindValue(p.windRange))} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="12" y1="20" x2="12" y2="4"></line>
                      <polyline points="5 11 12 4 19 11"></polyline>
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          {(p.tempRange || p.precipChance) && (
            <div className={`flex items-center justify-between gap-3 pt-1.5 border-t ${borderDividerClass}`}>
              <span className={`${VALUE} ${textOrangeClass}`}>{formatTempRangeString(p.tempRange, tempUnit)}</span>
              {p.precipChance ? (
                <span className={`text-body-sm ${textCyanClass}`}>
                  Precip <span className="font-mono font-medium">{p.precipChance}</span>
                </span>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
