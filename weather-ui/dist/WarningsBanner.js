import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CloudOff, TriangleAlert } from 'lucide-react';
/* ------------------------------------------------------------------------ */
/* Pure helpers, exported for the apps' own tests and for reuse.             */
/* ------------------------------------------------------------------------ */
const SEVERITY_RANK = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
/**
 * Alarm (red) or warning (amber) for one warning.
 *
 * Alarm when NWS rates it Severe or Extreme, when its name says it is a
 * Warning (the NWS word for a hazard occurring or imminent, whatever severity
 * the feed attached), or when there is no usable severity at all: both apps
 * showed every alert red until now, and a warning the feed failed to grade is
 * not a reason to play it down. Warning (amber) is reserved for what is
 * graded Moderate or Minor and is not named a Warning: advisories, watches,
 * statements. That is the split both apps' weather services already use for
 * their risk level (Severe/Extreme high, Moderate moderate).
 */
export function warningLevel(w) {
    if (w.level)
        return w.level;
    const sev = (w.severity || '').toLowerCase();
    if (sev === 'extreme' || sev === 'severe')
        return 'alarm';
    if (/\bwarning\b/i.test(w.event || ''))
        return 'alarm';
    if (sev === 'moderate' || sev === 'minor')
        return 'warning';
    return 'alarm';
}
/** Most severe first: alarm before warning, then NWS severity, then the host's order. */
export function sortWarnings(warnings) {
    return warnings
        .map((w, i) => ({ w, i }))
        .sort((a, b) => {
        const la = warningLevel(a.w) === 'alarm' ? 1 : 0;
        const lb = warningLevel(b.w) === 'alarm' ? 1 : 0;
        if (la !== lb)
            return lb - la;
        const sa = SEVERITY_RANK[(a.w.severity || '').toLowerCase()] ?? 0;
        const sb = SEVERITY_RANK[(b.w.severity || '').toLowerCase()] ?? 0;
        if (sa !== sb)
            return sb - sa;
        return a.i - b.i;
    })
        .map(({ w }) => w);
}
/**
 * "Gale Warning" -> "Gale warning". NWS event names arrive in title case; the
 * fleet writes sentence case. Words already in capitals (an acronym) keep them.
 */
export function sentenceCase(text) {
    const words = (text || '').trim().split(/\s+/);
    return words
        .map((word, i) => {
        if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word))
            return word;
        const lower = word.toLowerCase();
        return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
        .join(' ');
}
/** "just now", "12 min ago", "3 h ago", "2 days ago". Same wording as OceanSentinel's strip. */
export function formatCheckAge(checkedAt, now = Date.now()) {
    if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt))
        return null;
    const mins = Math.max(0, Math.floor((now - checkedAt) / 60000));
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48)
        return `${hours} h ago`;
    return `${Math.floor(hours / 24)} days ago`;
}
function formatWhen(iso, withDate) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toLocaleString(undefined, withDate
        ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
const NOTICE_TEXT = {
    'no-coverage': 'No warning service covers this position — not an all-clear',
    'no-position': 'No position, so no warnings checked — not an all-clear',
    'not-checked': "Couldn't check for warnings — not an all-clear",
};
/* Token classes. Every colour and radius resolves through @sentinel/theme, so
   `.theme-night` re-colours all of it. Both consuming apps already @source this
   package's dist for Tailwind. */
const TONE = {
    alarm: {
        band: 'border-[color:color-mix(in_srgb,var(--color-red)_40%,transparent)]',
        text: 'text-red',
        chip: 'bg-red-dim border-red text-text-primary',
    },
    warning: {
        band: 'border-[color:color-mix(in_srgb,var(--color-warning)_40%,transparent)]',
        text: 'text-warning',
        chip: 'bg-warning-dim border-warning text-text-primary',
    },
};
/* The glass surface, spelled out rather than `.glass-panel` so it carries the
   -webkit- form (older Android WebViews) and no shadow: the board draws none. */
const GLASS = 'bg-[var(--bg-panel-glass)] [-webkit-backdrop-filter:blur(16px)] [backdrop-filter:blur(16px)]';
const SURFACE = `${GLASS} rounded-xl border font-sans`;
/* ------------------------------------------------------------------------ */
export function WarningsBanner({ warnings, notice = null, area, usingChartCentre = false, detail, stale = false, checkedAt = null, partial = false, onOpen, onOpenForecast, defaultExpanded = false, now, className = '', }) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const listId = useId();
    const sorted = useMemo(() => sortWarnings((warnings || []).filter(Boolean)), [warnings]);
    if (sorted.length === 0) {
        if (!notice)
            return null;
        return _jsx(NoticeRow, { notice: notice, usingChartCentre: usingChartCentre, onOpen: onOpen, className: className });
    }
    const top = sorted[0];
    const level = warningLevel(top);
    const tone = TONE[level];
    const more = sorted.length - 1;
    const age = stale ? formatCheckAge(checkedAt, now) : null;
    const until = formatWhen(top.ends, false);
    /* The clause read after the event name, most useful first: the host's own
       statement, else when the top warning ends.
  
       Never cut with an ellipsis (fit-and-finish fixes, 2026-10-05). On a 412px
       phone the one 48px line came out as "… until Tue 08:00…": the event name
       and the expiry are facts, and a reader cannot act on the half of either
       that survives. So below `sm` the band grows to two lines instead of
       truncating -- the event name (and the +N chip) on the first, wrapping if it
       must, and the expiry and the host's statement under it -- and the expiry is
       shown there even when the host gave a statement, because on a phone there
       is room for both once the band may grow. From `sm` up it is the board's one
       48px line, as before. */
    const untilClause = until ? (_jsxs("span", { className: `whitespace-nowrap ${detail ? 'sm:hidden' : ''}`, "data-slot": "warnings-banner-until", children: ["until ", _jsx("span", { className: "font-mono", children: until })] })) : null;
    const detailClause = detail ? (_jsx("span", { className: "min-w-0 sm:truncate", "data-slot": "warnings-banner-detail", children: detail })) : null;
    const summary = (_jsxs(_Fragment, { children: [_jsx(TriangleAlert, { size: 20, strokeWidth: 1.75, "aria-hidden": true, className: `shrink-0 ${tone.text}` }), _jsxs("span", { className: "flex-1 min-w-0 flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-3", children: [_jsxs("span", { className: "flex items-center gap-3 min-w-0 max-w-full sm:max-w-[60%] sm:shrink-0", children: [_jsx("span", { className: `font-semibold min-w-0 sm:truncate ${tone.text}`, "data-slot": "warnings-banner-event", children: sentenceCase(top.event) }), more > 0 && (_jsxs("span", { "data-testid": "warnings-banner-count", className: `shrink-0 inline-flex items-center rounded-full border px-2 text-body-sm font-semibold whitespace-nowrap ${tone.chip}`, children: [_jsxs("span", { className: "font-mono", children: ["+", more] }), "\u00A0more"] }))] }), _jsxs("span", { className: "min-w-0 max-w-full flex flex-wrap items-center gap-x-2 text-text-secondary text-body-sm sm:text-body-md sm:flex-1 sm:flex-nowrap", children: [untilClause, detailClause, age && (_jsxs("span", { className: "shrink-0 whitespace-nowrap text-body-sm text-text-muted", children: ["last checked ", _jsx("span", { className: "font-mono", children: age })] })), usingChartCentre && _jsx("span", { className: "shrink-0 whitespace-nowrap text-body-sm text-text-muted", children: "Chart centre" })] })] })] }));
    const rowClass = 'w-full min-h-12 py-1.5 sm:h-12 sm:py-0 flex items-center gap-3 pl-4 pr-2 text-left text-body-md cursor-pointer ' +
        'rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';
    return (_jsxs("section", { "aria-label": "Marine warnings", role: level === 'alarm' ? 'alert' : 'status', className: `pointer-events-auto ${SURFACE} ${tone.band} ${className}`, children: [onOpen ? (_jsxs("button", { type: "button", className: rowClass, onClick: onOpen, children: [summary, _jsx(ChevronRight, { size: 20, strokeWidth: 1.75, "aria-hidden": true, className: "shrink-0 text-text-muted" })] })) : (_jsxs("button", { type: "button", className: rowClass, "aria-expanded": expanded, "aria-controls": listId, onClick: () => setExpanded((v) => !v), children: [summary, _jsx(ChevronDown, { size: 20, strokeWidth: 1.75, "aria-hidden": true, className: `shrink-0 text-text-muted transition-transform duration-[var(--motion-state)] ${expanded ? 'rotate-180' : ''}` })] })), !onOpen && expanded && (_jsxs("div", { id: listId, className: "px-4 pb-4 pt-1 flex flex-col gap-3 text-body-md text-text-primary", children: [(area || stale || partial) && (_jsxs("div", { className: "flex flex-col gap-1 text-body-sm text-text-secondary", children: [area && _jsx("span", { children: area }), stale && (_jsxs("span", { children: ["Couldn't check for warnings — these are from the last check", age && (_jsxs(_Fragment, { children: [", ", _jsx("span", { className: "font-mono", children: age })] })), ". Others may have been issued since."] })), partial && (_jsx("span", { children: "These may not be all the warnings in force: the warnings check failed, so these are read from the forecast." }))] })), _jsx("ul", { className: "flex flex-col gap-3", "aria-label": "Warnings in force", children: sorted.map((w, i) => (_jsx(WarningItem, { warning: w }, `${w.event}-${i}`))) }), onOpenForecast && (_jsx("button", { type: "button", onClick: onOpenForecast, className: "self-start min-h-12 text-body-md font-semibold text-cyan cursor-pointer hover:underline", children: "Open the full forecast" }))] }))] }));
}
function WarningItem({ warning }) {
    const tone = TONE[warningLevel(warning)];
    const from = formatWhen(warning.effective, true);
    const to = formatWhen(warning.ends, true);
    return (_jsxs("li", { className: `rounded-md border-l-4 ${tone.band} px-3 py-2 flex flex-col gap-1`, children: [_jsx("span", { className: `font-semibold ${tone.text}`, children: sentenceCase(warning.event) }), warning.headline && _jsx("span", { className: "text-body-md text-text-primary", children: warning.headline }), (from || to) && (_jsxs("span", { className: "text-body-sm font-mono text-text-muted", children: [from ?? '—', " \u2192 ", to ?? 'until further notice'] })), warning.instruction && (_jsx("span", { className: "text-body-sm text-text-secondary whitespace-pre-wrap", children: warning.instruction })), warning.senderName && _jsxs("span", { className: "text-body-sm text-text-muted", children: ["Issued by ", warning.senderName] })] }));
}
function NoticeRow({ notice, usingChartCentre, onOpen, className, }) {
    /* Quiet on purpose: the same glass as the banner, but a neutral hairline and
       secondary text, not a status colour. Outside NWS coverage this shows every day, and an amber band across
       the chart for a permanent condition is the H4 problem again. It must only
       never look like an all-clear, and it does not: it says so in words. */
    const body = (_jsxs(_Fragment, { children: [_jsx(CloudOff, { size: 16, strokeWidth: 1.75, "aria-hidden": true, className: "shrink-0 text-text-muted" }), _jsx("span", { className: "text-balance", children: NOTICE_TEXT[notice] }), usingChartCentre && _jsx("span", { className: "shrink-0 text-text-muted", children: "\u00B7 Chart centre" })] }));
    const shape = 'pointer-events-auto inline-flex w-fit max-w-full items-center gap-2 px-4 py-1.5 min-h-9 ' +
        `${GLASS} border border-border-color rounded-full ` +
        'font-sans text-body-sm text-text-secondary';
    return onOpen ? (_jsx("button", { type: "button", "data-notice": notice, onClick: onOpen, className: `${shape} text-left cursor-pointer ${className}`, children: body })) : (_jsx("div", { role: "status", "data-notice": notice, className: `${shape} ${className}`, children: body }));
}
export default WarningsBanner;
