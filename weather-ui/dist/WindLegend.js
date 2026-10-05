import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { WIND_BANDS } from './windScale';
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
export default function WindLegend({ isLightBg }) {
    return (_jsxs("div", { className: "glass-panel rounded-xl px-3 py-2 flex items-center gap-2 select-none pointer-events-none", children: [_jsx("span", { className: "text-label text-text-muted", children: "Wind" }), _jsx("div", { className: "flex items-end gap-px", children: WIND_BANDS.map((band) => (_jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "block w-6 sm:w-7 h-1.5 rounded-[1px]", style: { backgroundColor: `rgb(${isLightBg ? band.light : band.dark})` } }), _jsx("span", { className: "font-mono text-[13px] font-medium text-text-muted leading-none", children: band.from })] }, band.from))) }), _jsx("span", { className: "text-label text-text-muted", children: "kt" })] }));
}
