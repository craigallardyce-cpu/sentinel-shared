import React from 'react';
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
export declare function InstrumentCell({ label, value, unit, sub, size, tone, align, className, ...rest }: InstrumentCellProps): React.JSX.Element;
