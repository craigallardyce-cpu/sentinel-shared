import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from './cn';
const VALUE_TONE = {
    normal: 'text-text-primary',
    warning: 'text-warning',
    alarm: 'text-red',
};
const SUB_TONE = {
    normal: 'text-text-muted',
    warning: 'text-warning',
    alarm: 'text-red',
};
/** A run that starts with a digit and continues through the characters a reading uses. */
const NUMBER = /(\d[\d.,:°′″'/-]*)/;
/** Splits a string sub line so its numbers are set in mono and its words in Inter. */
function renderSub(sub) {
    if (typeof sub !== 'string')
        return sub;
    return sub.split(NUMBER).map((part, i) => i % 2 === 1 ? (_jsx("span", { className: "font-mono", children: part }, i)) : (part));
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
export function InstrumentCell({ label, value, unit, sub, size = 'readout', tone = 'normal', align = 'start', className, ...rest }) {
    return (_jsxs("div", { className: cn('flex flex-col gap-1.5 min-w-0 tabular-nums', align === 'center' ? 'items-center text-center' : 'items-start', className), ...rest, children: [_jsx("div", { className: "text-instrument-label text-text-muted", children: label }), _jsxs("div", { className: "flex items-baseline gap-1.5", children: [_jsx("span", { className: cn('font-mono font-bold', size === 'readout' ? 'text-readout' : 'text-instrument', VALUE_TONE[tone]), "data-slot": "value", children: value }), unit !== undefined && unit !== null && unit !== '' && (_jsx("span", { className: "font-mono font-medium text-[15px] text-text-muted", "data-slot": "unit", children: unit }))] }), sub !== undefined && sub !== null && sub !== '' && (_jsx("div", { className: cn('font-sans text-[13px] leading-[18px]', SUB_TONE[tone]), "data-slot": "sub", children: renderSub(sub) }))] }));
}
