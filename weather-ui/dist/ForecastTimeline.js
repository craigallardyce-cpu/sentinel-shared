import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Wind } from 'lucide-react';
import { motion } from 'motion/react';
import { getWindRotation, getHighestWindValue, formatTempRangeString } from './weatherUtils';
import { windBandColor } from './windScale';
import { nwsSentenceCase, windUnitKt } from './nwsText';
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

  The wind unit is "kt", as the fleet writes it: a host's "13 kts" is shown as
  "13 kt" (windUnitKt). The NWS prose is left exactly as NWS words it.
*/
const LABEL = 'text-label whitespace-nowrap';
const VALUE = 'text-data-mono-lg';
/** One label/value pair in the bulletin card's grid. */
function Field({ label, value, note, mutedClass, primaryClass, }) {
    return (_jsxs("div", { className: "flex flex-col gap-1 min-w-0", "data-slot": "forecast-field", children: [_jsx("dt", { className: `${LABEL} ${mutedClass}`, children: label }), _jsxs("dd", { className: `${VALUE} ${primaryClass}`, children: [value, note && _jsx("span", { className: `block font-sans text-body-sm ${mutedClass}`, children: note })] })] }));
}
export default function ForecastTimeline({ periods, tempUnit, mode = 'sidebar', placeNames, theme }) {
    if (!periods || periods.length === 0)
        return null;
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
        return (_jsx("div", { className: "flex flex-col gap-4 w-full", "data-slot": "forecast-bulletin", children: periods.map((period, i) => (_jsxs(motion.section, { 
                /* A surface entering: 200ms on the fleet curve, and a short rise. */
                initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: [0.2, 0, 0, 1], delay: Math.min(i, 6) * 0.04 }, "aria-label": period.periodName, className: `w-full p-4 sm:p-6 rounded-xl border text-left ${bulletinCardBgBorder}`, "data-slot": "forecast-card", children: [_jsx("h3", { className: `text-headline-md ${textPrimaryClass}`, children: period.periodName }), _jsxs("dl", { className: "mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4", children: [_jsx(Field, { label: "Max wind", value: windUnitKt(period.windRange), note: "incl. gusts", mutedClass: textMutedClass, primaryClass: textPrimaryClass }), _jsx(Field, { label: "Direction", value: period.windDirection || 'Variable', mutedClass: textMutedClass, primaryClass: textPrimaryClass }), _jsx(Field, { label: "Temperature", value: formatTempRangeString(period.tempRange, tempUnit), mutedClass: textMutedClass, primaryClass: textPrimaryClass }), _jsx(Field, { label: "Precipitation", value: period.precipChance || 'None', mutedClass: textMutedClass, primaryClass: textPrimaryClass })] }), period.reason && (_jsx("p", { className: `mt-4 text-body-md ${textSecondaryClass}`, title: period.reason, "data-slot": "forecast-text", children: nwsSentenceCase(period.reason, { names: placeNames }) }))] }, i))) }));
    }
    // Sidebar: the next four periods, compact.
    return (_jsx("div", { className: "grid grid-cols-1 gap-2 w-full", children: periods.slice(0, 4).map((p, idx) => (_jsxs("div", { className: `flex flex-col gap-1.5 text-left ${cardBgBorder}`, children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "flex flex-col min-w-0", children: [_jsx("span", { className: `font-sans text-[15px] font-semibold leading-[22px] ${textPrimaryClass}`, children: p.periodName }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Wind, { size: 16, strokeWidth: 1.75, "aria-hidden": true, className: `shrink-0 ${windIconClass}` }), _jsx("span", { className: `${VALUE} ${textPrimaryClass}`, children: windUnitKt(p.windRange) })] })] }), p.windDirection && (_jsxs("div", { className: "flex flex-col items-end shrink-0", children: [_jsx("span", { className: `${LABEL} ${textMutedClass}`, children: "Direction" }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: `${VALUE} ${textSecondaryClass}`, children: p.windDirection }), _jsx("div", { style: { transform: `rotate(${getWindRotation(p.windDirection)}deg)`, transformOrigin: 'center' }, className: "transition-transform duration-500 ease-out flex items-center justify-center w-4 h-4", title: `Wind from ${p.windDirection}`, children: _jsxs("svg", { className: "wind-band-arrow", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: windBandColor(getHighestWindValue(p.windRange)), strokeWidth: "3", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, children: [_jsx("line", { x1: "12", y1: "20", x2: "12", y2: "4" }), _jsx("polyline", { points: "5 11 12 4 19 11" })] }) })] })] }))] }), (p.tempRange || p.precipChance) && (_jsxs("div", { className: `flex items-center justify-between gap-3 pt-1.5 border-t ${borderDividerClass}`, children: [_jsx("span", { className: `${VALUE} ${textOrangeClass}`, children: formatTempRangeString(p.tempRange, tempUnit) }), p.precipChance ? (_jsxs("span", { className: `text-body-sm ${textCyanClass}`, children: ["Precip ", _jsx("span", { className: "font-mono font-medium", children: p.precipChance })] })) : null] }))] }, idx))) }));
}
