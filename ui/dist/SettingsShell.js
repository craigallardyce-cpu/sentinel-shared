import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Download, Info, Monitor, Settings as SettingsIcon } from 'lucide-react';
import { cn } from './cn';
import { Modal } from './Modal';
import { Toggle } from './Toggle';
import { Stepper } from './Stepper';
import { UpdatePanel } from './UpdatePanel';
import { ScopeBadge } from './ScopeBadge';
/**
 * One settings group: eyebrow title with icon, optional one-line description, then rows.
 *
 * Scope badges throughout this dialog are drawn only where a value actually
 * departs from its default. Showing "DEFAULT" beside every untouched field put a
 * chip on nearly every row, which made a genuinely interesting one — "THIS
 * DEVICE" on a value that is not shared with the boat — read as more of the same
 * noise. The dialog's summary line carries the legend for all of them.
 */
export function SettingsSection({ title, icon, description, children, className }) {
    return (_jsxs("section", { className: cn('space-y-3', className), children: [_jsxs("header", { children: [_jsxs("h3", { className: "flex items-center gap-2 text-[13px] font-mono font-bold uppercase tracking-wider text-cyan", children: [icon && _jsx("span", { className: "shrink-0", "aria-hidden": true, children: icon }), title] }), description && _jsx("p", { className: "text-xs text-text-muted mt-1", children: description })] }), _jsx("div", { className: "space-y-3", children: children })] }));
}
/**
 * One settings row: label and description on the left, control on the right, and
 * — when the caller knows it — a chip saying which layer the value came from.
 */
export function SettingsRow({ label, description, source, action, children, className, }) {
    return (_jsxs("div", { className: cn('flex items-center justify-between gap-4 p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl', className), children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-sm text-text-primary", children: label }), source && _jsx(ScopeBadge, { source: source, hideWhenUnset: true })] }), description && _jsx("div", { className: "text-xs text-text-muted mt-0.5", children: description })] }), _jsxs("div", { className: "shrink-0 flex items-center gap-2", children: [action, children] })] }));
}
/**
 * The fleet settings dialog: Display (night mode, brightness, keep awake) →
 * the app's own sections → Updates → About. Every app gets the same chrome and
 * the same standard sections, and only supplies what is genuinely its own.
 */
export function SettingsShell({ open, onClose, appName, appIcon, version, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, updater, children, tabs, displayExtra, footer, size = 'lg', about, summary, sources, title = 'Settings', }) {
    const showDisplay = onNightModeChange || onDayBrightnessChange || onNightBrightnessChange || onKeepAwakeChange;
    const shownVersion = updater?.state.currentVersion || version;
    const displaySection = showDisplay ? renderDisplay({
        appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange,
        nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources,
        displayExtra,
    }) : null;
    const updatesSection = updater ? (_jsx(SettingsSection, { title: "Updates", icon: _jsx(Download, { size: 12 }), children: _jsx(UpdatePanel, { updater: updater, className: "p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl" }) })) : null;
    const aboutSection = renderAbout({ appName, appIcon, shownVersion, about });
    /* Tabbed mode. The shell's own join the app's rather than sitting outside them,
       so every section in the dialog is reachable the same way.
  
       Updates and About share a tab, because they answer one question between
       them: what am I running, and is it current. Apart they were two tabs whose
       combined content is an app name, a version and a button — and the version
       appeared in both, since UpdatePanel states it too. Together the About card
       drops its own copy and UpdatePanel's stands, which is the more useful of the
       two because it also says whether that version is up to date.
  
       The scrolling layout leaves them as two adjacent sections, unchanged. There
       the duplication costs a line; here it cost a click and a tab. */
    const combinedAbout = updatesSection ? (_jsxs("div", { className: "space-y-8", children: [renderAbout({ appName, appIcon, shownVersion: undefined, about }), updatesSection] })) : aboutSection;
    const allTabs = tabs
        ? [
            ...(displaySection ? [{ id: '__display', label: 'Display', icon: _jsx(Monitor, { size: 12 }), content: displaySection }] : []),
            ...tabs,
            { id: '__about', label: 'About', icon: _jsx(Info, { size: 12 }), content: combinedAbout },
        ]
        : [];
    const [activeTab, setActiveTab] = React.useState(() => allTabs[0]?.id ?? '');
    const activeId = allTabs.some((t) => t.id === activeTab) ? activeTab : allTabs[0]?.id;
    /* Keep the selected tab inside the scroll window.
     *
     * The strip scrolls once the tabs outrun the dialog, and nothing was putting
     * the selected one back in view — so it could sit half out of the left edge,
     * showing the tail of its own label ("…AY" for Display) while reading as
     * selected. Adjusting this element's own scrollLeft rather than calling
     * scrollIntoView, which would also scroll the dialog body and the page behind
     * it.
     */
    const stripRef = React.useRef(null);
    React.useEffect(() => {
        const strip = stripRef.current;
        if (!strip || !activeId)
            return;
        const tab = strip.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);
        if (!tab)
            return;
        /* Measured with getBoundingClientRect rather than offsetLeft: offsetLeft is
           relative to the nearest positioned ancestor, which is not this strip, so it
           left the tab a padding's width short of actually being in view. */
        const t = tab.getBoundingClientRect();
        const r = strip.getBoundingClientRect();
        const pad = 8;
        if (t.left < r.left + pad)
            strip.scrollLeft -= r.left + pad - t.left;
        else if (t.right > r.right - pad)
            strip.scrollLeft += t.right - (r.right - pad);
    }, [activeId]);
    if (tabs) {
        return (_jsxs(Modal, { open: open, onClose: onClose, title: title, description: summary, icon: _jsx(SettingsIcon, { size: 18 }), size: size, footer: footer, bodyClassName: "space-y-5", children: [_jsx("div", { ref: stripRef, role: "tablist", "aria-label": "Settings sections", className: "flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border-color/40", children: allTabs.map((t) => (_jsxs("button", { "data-tab-id": t.id, role: "tab", type: "button", "aria-selected": t.id === activeId, "aria-controls": `settings-panel-${t.id}`, onClick: () => setActiveTab(t.id), className: cn('flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-t-lg text-[13px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer border-b-2 -mb-px', t.id === activeId
                            ? 'border-cyan text-cyan'
                            : 'border-transparent text-text-muted hover:text-text-secondary'), children: [t.icon && _jsx("span", { className: "shrink-0", "aria-hidden": true, children: t.icon }), t.label] }, t.id))) }), allTabs.map((t) => (_jsx("div", { id: `settings-panel-${t.id}`, role: "tabpanel", hidden: t.id !== activeId, children: t.content }, t.id)))] }));
    }
    return (_jsxs(Modal, { open: open, onClose: onClose, title: title, description: summary, icon: _jsx(SettingsIcon, { size: 18 }), size: size, footer: footer, bodyClassName: "space-y-8", children: [displaySection, children, updatesSection, aboutSection] }));
}
/** The fleet's standard Display group, shared by both layouts. */
function renderDisplay({ appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources, displayExtra, }) {
    return (_jsxs(SettingsSection, { title: "Display", icon: _jsx(Monitor, { size: 12 }), children: [onNightModeChange && (_jsx(SettingsRow, { label: "Night mode", description: "Red-shifted palette that preserves night vision.", source: sources?.nightMode, children: _jsx(Toggle, { checked: !!nightMode, onChange: onNightModeChange, "aria-label": "Night mode" }) })), (onDayBrightnessChange || onNightBrightnessChange) && (_jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3", children: [onDayBrightnessChange && (_jsxs("div", { className: "p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl space-y-2", children: [_jsxs("div", { className: "flex justify-between items-center text-xs gap-2", children: [_jsxs("span", { className: "text-text-secondary flex items-center gap-2", children: ["Day brightness", sources?.dayBrightness && _jsx(ScopeBadge, { source: sources.dayBrightness, hideWhenUnset: true })] }), _jsxs("span", { className: "font-mono font-bold text-cyan", children: [dayBrightness ?? 100, "%"] })] }), _jsx(Stepper, { min: 20, max: 100, step: 5, value: dayBrightness ?? 100, onChange: onDayBrightnessChange })] })), onNightBrightnessChange && (_jsxs("div", { className: "p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl space-y-2", children: [_jsxs("div", { className: "flex justify-between items-center text-xs gap-2", children: [_jsxs("span", { className: "text-text-secondary flex items-center gap-2", children: ["Night brightness", sources?.nightBrightness && _jsx(ScopeBadge, { source: sources.nightBrightness, hideWhenUnset: true })] }), _jsxs("span", { className: "font-mono font-bold text-red", children: [nightBrightness ?? 100, "%"] })] }), _jsx(Stepper, { min: 10, max: 100, step: 5, value: nightBrightness ?? 100, onChange: onNightBrightnessChange, colorClass: "text-red" })] }))] })), onKeepAwakeChange && (_jsx(SettingsRow, { label: "Keep the screen awake", description: `Stops the device sleeping while ${appName} is open.`, source: sources?.keepAwake, children: _jsx(Toggle, { checked: !!keepAwake, onChange: onKeepAwakeChange, "aria-label": "Keep the screen awake" }) })), displayExtra] }));
}
/** About, shared by both layouts. */
function renderAbout({ appName, appIcon, shownVersion, about, }) {
    return (_jsx(SettingsSection, { title: "About", icon: _jsx(Info, { size: 12 }), children: _jsxs("div", { className: "flex items-center gap-3 p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl", children: [appIcon && _jsx("span", { className: "flex h-9 w-9 items-center justify-center rounded-lg bg-cyan/10 text-cyan shrink-0", children: appIcon }), _jsxs("div", { className: "min-w-0 text-xs", children: [_jsxs("p", { className: "text-sm font-heading font-semibold text-text-primary", children: [appName, " ", shownVersion && _jsxs("span", { className: "font-mono font-normal text-text-muted", children: ["v", shownVersion] })] }), _jsxs("p", { className: "text-text-muted mt-0.5", children: ["Part of the Mariner Sentinel fleet \u00B7", ' ', _jsx("a", { href: "https://marinersentinel.com", target: "_blank", rel: "noreferrer", className: "text-cyan hover:underline", children: "marinersentinel.com" })] }), about] })] }) }));
}
