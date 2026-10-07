import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { cn } from './cn';
import { Modal } from './Modal';
import { Toggle } from './Toggle';
import { Stepper } from './Stepper';
import { UpdatePanel } from './UpdatePanel';
import { ScopeBadge } from './ScopeBadge';
import { Tabs } from './Tabs';
import { Button } from './Button';
/*
  The Settings dialog (fit-and-finish X5; SettingsDayAfter / SettingsNightAfter).

  One layout in all three apps: titled "Settings", a sentence-case tab strip
  with a 2px accent stroke, rows that are flat and separated by hairlines rather
  than each drawn in its own box, a 6px dot beside a value set on this device
  (explained once, in the header), and Save and apply on the right of the
  footer as the primary action.
*/
/** The hairline between rows. One colour, used for every divider in the dialog. */
const ROW_DIVIDER = 'border-b border-bg-highest last:border-b-0';
/**
 * One settings group: a quiet sentence-case heading, an optional one-line
 * description, then rows.
 *
 * Scope dots are drawn only where a value actually departs from its default.
 * Each dot explains itself in its tooltip.
 */
export function SettingsSection({ title, description, children, className, hideTitle = false }) {
    return (_jsxs("section", { className: cn('flex flex-col', className), "aria-label": hideTitle && typeof title === 'string' ? title : undefined, children: [(!hideTitle || description) && (_jsxs("header", { className: "pb-1", children: [!hideTitle && _jsx("h3", { className: "font-sans text-[13px] font-semibold leading-[18px] text-text-muted", children: title }), description && _jsx("p", { className: cn('text-[13px] text-text-muted', !hideTitle && 'mt-1'), children: description })] })), _jsx("div", { className: "flex flex-col", children: children })] }));
}
/**
 * One settings row: label and description on the left, control on the right,
 * and -- when the caller knows it -- a dot saying which layer the value came from.
 *
 * Flat: no box of its own. Rows are separated by a hairline, and the last row
 * in a group has none.
 */
export function SettingsRow({ label, description, source, action, children, className, }) {
    return (_jsxs("div", { className: cn('flex items-center justify-between gap-6 py-4', ROW_DIVIDER, className), children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-sans text-[15px] font-semibold text-text-primary", children: label }), source && _jsx(ScopeBadge, { source: source, hideWhenUnset: true })] }), description && _jsx("div", { className: "text-[13px] text-text-muted mt-1", children: description })] }), _jsxs("div", { className: "shrink-0 flex items-center gap-2", children: [action, children] })] }));
}
/**
 * The fleet settings dialog: Display (night mode, brightness, keep awake) →
 * the app's own sections → Updates → About. Every app gets the same chrome and
 * the same standard sections, and only supplies what is genuinely its own.
 */
export function SettingsShell({ open, onClose, appName, appIcon, version, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, updater, children, tabs, displayExtra, footer, onSave, saveLabel = 'Save and apply', saving = false, saveDisabled = false, size = 'lg', about, summary, sources, title = 'Settings', }) {
    const showDisplay = onNightModeChange || onDayBrightnessChange || onNightBrightnessChange || onKeepAwakeChange;
    const shownVersion = updater?.state.currentVersion || version;
    /* In tabbed mode the strip names each tab, so the section under it does not
       repeat the name. In the scrolling layout the heading is the only thing that
       separates one group from the next, so it stays. */
    const inTabs = !!tabs;
    const displaySection = showDisplay ? renderDisplay({
        appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange,
        nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources,
        displayExtra,
    }, inTabs) : null;
    const updatesSection = updater ? (_jsx(SettingsSection, { title: "Updates", children: _jsx(UpdatePanel, { updater: updater, className: cn('py-4', ROW_DIVIDER) }) })) : null;
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
    const combinedAbout = updatesSection ? (_jsxs("div", { className: "space-y-6", children: [renderAbout({ appName, appIcon, shownVersion: undefined, about }, inTabs), updatesSection] })) : inTabs ? renderAbout({ appName, appIcon, shownVersion, about }, true) : aboutSection;
    const allTabs = tabs
        ? [
            ...(displaySection ? [{ id: '__display', label: 'Display', content: displaySection }] : []),
            ...tabs,
            { id: '__about', label: 'About', content: combinedAbout },
        ]
        : [];
    const [activeTab, setActiveTab] = React.useState(() => allTabs[0]?.id ?? '');
    const activeId = allTabs.some((t) => t.id === activeTab) ? activeTab : allTabs[0]?.id ?? '';
    /* Save and apply is the primary action, on the right. Anything else the app
       puts in the footer sits on the left, away from it. */
    const footerContent = onSave ? (_jsxs(_Fragment, { children: [footer && _jsx("div", { className: "mr-auto flex flex-wrap items-center gap-2", children: footer }), _jsx(Button, { variant: "primary", onClick: onSave, loading: saving, disabled: saveDisabled, children: saveLabel })] })) : footer;
    if (tabs) {
        return (_jsx(Modal, { open: open, onClose: onClose, title: title, description: summary, size: size, footer: footerContent, subheader: _jsx(Tabs, { items: allTabs.map((t) => ({ id: t.id, label: t.label })), value: activeId, onChange: setActiveTab, "aria-label": "Settings sections", idPrefix: "settings", className: "px-4" }), children: allTabs.map((t) => (_jsx("div", { id: `settings-panel-${t.id}`, role: "tabpanel", "aria-labelledby": `settings-tab-${t.id}`, hidden: t.id !== activeId, children: t.content }, t.id))) }));
    }
    return (_jsxs(Modal, { open: open, onClose: onClose, title: title, description: summary, size: size, footer: footerContent, bodyClassName: "space-y-8", children: [displaySection, children, updatesSection, aboutSection] }));
}
/** A label with its scope dot, as the brightness pair draws it. */
function BrightnessLabel({ children, source }) {
    return (_jsxs("span", { className: "flex items-center gap-2 font-sans text-[15px] font-semibold text-text-primary", children: [children, source && _jsx(ScopeBadge, { source: source, hideWhenUnset: true })] }));
}
/** The fleet's standard Display group, shared by both layouts. */
function renderDisplay({ appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources, displayExtra, }, hideTitle = false) {
    /* Both brightness steppers are drawn in the accent. Night brightness used to
       be red, which is the alarm colour doing a slider's job in day mode (X2);
       at night the accent is red-shifted anyway. */
    const stepperSurface = 'border-border-color bg-transparent hover:bg-bg-card-hover';
    return (_jsxs(SettingsSection, { title: "Display", hideTitle: hideTitle, children: [onNightModeChange && (_jsx(SettingsRow, { label: "Night mode", description: "Red-shifted palette that preserves night vision.", source: sources?.nightMode, children: _jsx(Toggle, { checked: !!nightMode, onChange: onNightModeChange, "aria-label": "Night mode" }) })), (onDayBrightnessChange || onNightBrightnessChange) && (_jsxs("div", { className: cn('grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 py-4', ROW_DIVIDER), children: [onDayBrightnessChange && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex justify-between items-baseline gap-2", children: [_jsx(BrightnessLabel, { source: sources?.dayBrightness, children: "Day brightness" }), _jsxs("span", { className: "font-mono text-[15px] font-medium text-text-primary tabular-nums", children: [dayBrightness ?? 100, "%"] })] }), _jsx(Stepper, { min: 20, max: 100, step: 5, value: dayBrightness ?? 100, onChange: onDayBrightnessChange, surfaceClassName: stepperSurface, trackClassName: "bg-bg-highest" })] })), onNightBrightnessChange && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex justify-between items-baseline gap-2", children: [_jsx(BrightnessLabel, { source: sources?.nightBrightness, children: "Night brightness" }), _jsxs("span", { className: "font-mono text-[15px] font-medium text-text-primary tabular-nums", children: [nightBrightness ?? 100, "%"] })] }), _jsx(Stepper, { min: 10, max: 100, step: 5, value: nightBrightness ?? 100, onChange: onNightBrightnessChange, surfaceClassName: stepperSurface, trackClassName: "bg-bg-highest" })] }))] })), onKeepAwakeChange && (_jsx(SettingsRow, { label: "Keep the screen awake", description: `Stops the device sleeping while ${appName} is open.`, source: sources?.keepAwake, children: _jsx(Toggle, { checked: !!keepAwake, onChange: onKeepAwakeChange, "aria-label": "Keep the screen awake" }) })), displayExtra] }));
}
/** About, shared by both layouts. */
function renderAbout({ appName, appIcon, shownVersion, about, }, hideTitle = false) {
    return (_jsx(SettingsSection, { title: "About", hideTitle: hideTitle, children: _jsxs("div", { className: cn('flex items-start gap-3 py-4', ROW_DIVIDER), children: [appIcon && _jsx("span", { className: "flex h-10 w-10 items-center justify-center rounded-md bg-cyan-dim text-cyan shrink-0", children: appIcon }), _jsxs("div", { className: "min-w-0 text-[13px]", children: [_jsxs("p", { className: "font-sans text-[15px] font-semibold text-text-primary", children: [appName, " ", shownVersion && _jsxs("span", { className: "font-mono font-medium text-text-muted", children: ["v", shownVersion] })] }), _jsxs("p", { className: "text-text-muted mt-1", children: ["Part of the MarinerSentinel fleet \u00B7", ' ', _jsx("a", { href: "https://marinersentinel.com", target: "_blank", rel: "noreferrer", className: "text-cyan hover:underline", children: "marinersentinel.com" })] }), about] })] }) }));
}
