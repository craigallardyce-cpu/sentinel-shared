import React from 'react';
import { cn } from './cn';

/**
 * `normal` draws the reading in the text colour; `warning` and `alarm` colour
 * the value and the sub line with the fleet's status colours. There is no `ok`:
 * a reading inside its limits is the ordinary case and stays quiet.
 */
export type InstrumentTone = 'normal' | 'warning' | 'alarm';

export interface InstrumentCellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The quiet label over the reading: "Depth", "Wind", "SOG". Drawn uppercase by the type style. */
  label: React.ReactNode;
  /** The reading itself. A string or number; drawn mono 700 with tabular figures. */
  value: React.ReactNode;
  /** Beside the value on its baseline: "ft", "kt", ":1", "°M". */
  unit?: React.ReactNode;
  /**
   * One quiet line under the value, typically the limit it is judged against:
   * "Limit 125", "Min 5:1". A string has its numbers set in mono automatically;
   * pass an element to lay it out yourself.
   */
  sub?: React.ReactNode;
  /**
   * `readout` (40px, the default) for the strip read from across the cockpit;
   * `instrument` (24px) for a panel of several readings, like OceanSentinel's HUD.
   */
  size?: 'readout' | 'instrument';
  tone?: InstrumentTone;
  /** `start` (default) left-aligns the three lines; `center` centres them in the cell. */
  align?: 'start' | 'center';
}

const VALUE_TONE: Record<InstrumentTone, string> = {
  normal: 'text-text-primary',
  warning: 'text-warning',
  alarm: 'text-red',
};

const SUB_TONE: Record<InstrumentTone, string> = {
  normal: 'text-text-muted',
  warning: 'text-warning',
  alarm: 'text-red',
};

/** A run that starts with a digit and continues through the characters a reading uses. */
const NUMBER = /(\d[\d.,:°′″'/-]*)/;

/** Splits a string sub line so its numbers are set in mono and its words in Inter. */
function renderSub(sub: React.ReactNode): React.ReactNode {
  if (typeof sub !== 'string') return sub;
  return sub.split(NUMBER).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-mono">
        {part}
      </span>
    ) : (
      part
    )
  );
}

/**
 * One instrument reading: a quiet label, a large value with its unit beside
 * it, and one optional line under it (fit-and-finish X7).
 *
 * The one primitive for HarborSentinel's instrument strip and OceanSentinel's
 * HUD, which presented the same kind of reading two different ways. The value
 * is the loudest thing in the cell; everything else is muted, so the eye goes
 * to the number first.
 *
 * It draws no box and no border of its own. A strip of cells is laid out by the
 * caller -- a grid, with a 1px hairline between cells -- because where the lines
 * go depends on the strip, not the reading:
 *
 * ```tsx
 * <div className="grid grid-cols-4 divide-x divide-bg-highest">
 *   <InstrumentCell label="Depth" value="18.2" unit="ft" sub="Min 7" />
 *   <InstrumentCell label="Scope" value="4.2" unit=":1" sub="Min 5:1" tone="warning" />
 * </div>
 * ```
 *
 * Night mode needs nothing here: every colour is a token.
 */
export function InstrumentCell({
  label,
  value,
  unit,
  sub,
  size = 'readout',
  tone = 'normal',
  align = 'start',
  className,
  ...rest
}: InstrumentCellProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 min-w-0 tabular-nums',
        align === 'center' ? 'items-center text-center' : 'items-start',
        className
      )}
      {...rest}
    >
      <div className="text-instrument-label text-text-muted">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn('font-mono font-bold', size === 'readout' ? 'text-readout' : 'text-instrument', VALUE_TONE[tone])}
          data-slot="value"
        >
          {value}
        </span>
        {unit !== undefined && unit !== null && unit !== '' && (
          <span className="font-mono font-medium text-[15px] text-text-muted" data-slot="unit">
            {unit}
          </span>
        )}
      </div>
      {sub !== undefined && sub !== null && sub !== '' && (
        <div className={cn('font-sans text-[13px] leading-[18px]', SUB_TONE[tone])} data-slot="sub">
          {renderSub(sub)}
        </div>
      )}
    </div>
  );
}
