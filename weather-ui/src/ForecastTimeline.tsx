import React from 'react';
import { Wind } from 'lucide-react';
import { motion } from 'motion/react';
import { getWindRotation, getHighestWindValue, formatTempRangeString } from './weatherUtils';
import { windBandColor } from './windScale';

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
    cardBgBorder?: string;
    bulletinCardBgBorder?: string;
    windIconClass?: string;
    textMutedClass?: string;
    textPrimaryClass?: string;
    textSecondaryClass?: string;
    textOrangeClass?: string;
    textCyanClass?: string;
    gridBgClass?: string;
    borderDividerClass?: string;
  };
}

export default function ForecastTimeline({ 
  periods, 
  tempUnit, 
  mode = 'sidebar',
  theme
}: ForecastTimelineProps) {
  if (!periods || periods.length === 0) return null;

  // Ocean Sentinel styles as defaults
  const cardBgBorder = theme?.cardBgBorder || 'bg-bg-card/60 border-border-color/30';
  const bulletinCardBgBorder = theme?.bulletinCardBgBorder || 'bg-bg-card/30 border-border-color/10 hover:bg-bg-card/50 hover:border-border-color/20';
  const windIconClass = theme?.windIconClass || 'text-cyan';
  const textMutedClass = theme?.textMutedClass || 'text-text-muted';
  const textPrimaryClass = theme?.textPrimaryClass || 'text-text-primary';
  const textSecondaryClass = theme?.textSecondaryClass || 'text-text-secondary';
  const textOrangeClass = theme?.textOrangeClass || 'text-orange';
  const textCyanClass = theme?.textCyanClass || 'text-cyan/80';
  const gridBgClass = theme?.gridBgClass || 'bg-bg-lowest/60 border-border-color/10';
  const borderDividerClass = theme?.borderDividerClass || 'border-border-color/20';

  if (mode === 'bulletin') {
    return (
      <div className="grid grid-cols-1 gap-5">
        {periods.map((period, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className={`p-6 border rounded-xl space-y-4 transition-all duration-300 shadow-lg text-left ${bulletinCardBgBorder}`}
          >
            <div className={`flex items-center justify-between border-b pb-2 ${borderDividerClass}`}>
              <span className={`text-sm font-extrabold uppercase tracking-widest ${textPrimaryClass}`}>{period.periodName}</span>
            </div>

            <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg border ${gridBgClass}`}>
              <div className="flex flex-col space-y-1">
                <span className={`text-[13px] font-mono uppercase tracking-widest leading-none ${textMutedClass}`}>Max Wind (Inc Gusts)</span>
                <span className={`text-sm font-mono font-bold ${textPrimaryClass}`}>{period.windRange}</span>
              </div>
              <div className="flex flex-col space-y-1">
                <span className={`text-[13px] font-mono uppercase tracking-widest leading-none ${textMutedClass}`}>Direction</span>
                <span className={`text-sm font-mono font-bold ${textPrimaryClass}`}>{period.windDirection || 'Variable'}</span>
              </div>
              <div className="flex flex-col space-y-1">
                <span className={`text-[13px] font-mono uppercase tracking-widest leading-none ${textMutedClass}`}>Temperature</span>
                <span className={`text-sm font-mono font-bold ${textPrimaryClass}`}>{formatTempRangeString(period.tempRange, tempUnit)}</span>
              </div>
              <div className="flex flex-col space-y-1">
                <span className={`text-[13px] font-mono uppercase tracking-widest leading-none ${textMutedClass}`}>Precipitation</span>
                <span className={`text-sm font-mono font-bold ${textPrimaryClass}`}>{period.precipChance || 'None'}</span>
              </div>
            </div>

            <div className="pt-1">
              <p className={`text-xs leading-relaxed font-mono uppercase ${textSecondaryClass}`}>
                {period.reason}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  // Sidebar compact mode (slice(0, 4))
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {periods.slice(0, 4).map((p, idx) => (
        <div key={idx} className={`flex flex-col p-3 rounded-lg border space-y-1.5 text-left ${cardBgBorder}`}>
          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className={`text-[13px] font-mono truncate uppercase font-bold ${textMutedClass}`}>{p.periodName}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Wind size={8} className={`${windIconClass} animate-pulse`} />
                <span className={`text-[13px] font-mono font-bold ${textPrimaryClass}`}>{p.windRange}</span>
              </div>
            </div>
            {p.windDirection && (
              <div className="flex flex-col items-end shrink-0">
                <span className={`text-[13px] font-mono uppercase font-bold ${textMutedClass}`}>Dir</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className={`text-[13px] font-mono font-bold ${textSecondaryClass}`}>{p.windDirection}</span>
                  <div 
                    style={{ transform: `rotate(${getWindRotation(p.windDirection)}deg)`, transformOrigin: 'center' }} 
                    className="transition-transform duration-500 ease-out flex items-center justify-center w-3 h-3"
                    title={`Wind from ${p.windDirection}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={windBandColor(getHighestWindValue(p.windRange))} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="20" x2="12" y2="4"></line>
                      <polyline points="5 11 12 4 19 11"></polyline>
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          {(p.tempRange || p.precipChance) && (
            <div className={`flex items-center justify-between pt-1.5 border-t text-[13px] font-mono ${borderDividerClass}`}>
              <span className={textOrangeClass}>{formatTempRangeString(p.tempRange, tempUnit)}</span>
              <span className={textCyanClass}>{p.precipChance ? `Precip: ${p.precipChance}` : ''}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
