import React from 'react';
import { type ModalSize } from './Modal';
import type { SettingSource } from './ScopeBadge';
import { type AppUpdater } from './useAppUpdater';
export interface SettingsSectionProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
    /**
     * Draw the group without its heading row.
     *
     * For a section that is the whole of a tab, where the tab strip has already
     * said its name a few pixels above. "DISPLAY" appeared twice on the Display
     * tab -- once as the selected tab and once as the heading under it -- and so
     * did every other tab's name, which is a title bar arguing with itself. The
     * description still renders, because that says something the tab does not.
     */
    hideTitle?: boolean;
}
/**
 * One settings group: a quiet sentence-case heading, an optional one-line
 * description, then rows.
 *
 * Scope dots are drawn only where a value actually departs from its default.
 * Each dot explains itself in its tooltip.
 */
export declare function SettingsSection({ title, description, children, className, hideTitle }: SettingsSectionProps): React.JSX.Element;
/**
 * One settings row: label and description on the left, control on the right,
 * and -- when the caller knows it -- a dot saying which layer the value came from.
 *
 * Flat: no box of its own. Rows are separated by a hairline, and the last row
 * in a group has none.
 */
export declare function SettingsRow({ label, description, source, action, children, className, }: {
    label: React.ReactNode;
    description?: React.ReactNode;
    /** Which layer answered. Omit where provenance is not knowable or not useful. */
    source?: SettingSource;
    /** Usually a Clear override button. */
    action?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
}): React.JSX.Element;
export interface SettingsTab {
    id: string;
    label: string;
    content: React.ReactNode;
}
export interface SettingsShellProps {
    open: boolean;
    onClose: () => void;
    appName: string;
    appIcon?: React.ReactNode;
    /** Shown in About; the updater's currentVersion wins when present. */
    version?: string;
    nightMode?: boolean;
    onNightModeChange?: (on: boolean) => void;
    dayBrightness?: number;
    onDayBrightnessChange?: (pct: number) => void;
    nightBrightness?: number;
    onNightBrightnessChange?: (pct: number) => void;
    keepAwake?: boolean;
    onKeepAwakeChange?: (on: boolean) => void;
    updater?: AppUpdater;
    /** App-specific sections, built from <SettingsSection>/<SettingsRow>. Rendered between Display and Updates. */
    children?: React.ReactNode;
    /**
     * App-specific rows appended to the end of the built-in Display group, after
     * "Keep the screen awake".
     *
     * For settings that are a continuation of one of Display's own rather than a
     * subject of their own. HarborSentinel's auto-dim is the case this exists for:
     * it has nothing to dim unless something is holding the screen on, so as its
     * own group — or, once the dialog gained tabs, its own tab — it read as a
     * separate topic when it is really the next question after keep-awake.
     */
    displayExtra?: React.ReactNode;
    /**
     * App-specific sections as tabs instead of one scroll.
     *
     * Additive and opt-in: without it the dialog is exactly the scrolling column
     * it has always been, so an app that has three sections keeps them stacked.
     * With it, the shell's own Display, Updates and About become tabs alongside
     * the app's, and `children` is ignored.
     *
     * Worth it past about six sections. HarborSentinel had eight in a single
     * scroll -- Display, Device sleep, Vessel, Position, Units, Telegram, Updates,
     * About -- which is a scroll you have to remember your way down.
     */
    tabs?: SettingsTab[];
    /**
     * With `tabs`: the tab to show each time the dialog opens, by its `id` (an
     * app's own, or `__display` / `__about`). Without it the dialog keeps the
     * tab it was last left on. OceanSentinel's header Muted badge opens Settings
     * on Alerts & sync this way.
     */
    initialTab?: string;
    /**
     * The `id` of a control to focus once the dialog has opened, after the
     * dialog's own first focus, scrolled into view. Pair it with `initialTab`
     * when the control is on a tab other than the first.
     */
    initialFocus?: string;
    /**
     * Footer content. With `onSave`, it sits on the left and Save and apply on the
     * right; without it, it is the whole footer, right-aligned.
     */
    footer?: React.ReactNode;
    /**
     * Draws Save and apply as the footer's primary action, on the right. The one
     * shape for the dialog's commit button in every app (fit-and-finish X5);
     * prefer it to a hand-built button in `footer`.
     */
    onSave?: () => void;
    /** The Save button's label. Default "Save and apply". */
    saveLabel?: string;
    /** Shows a spinner on Save and disables it. */
    saving?: boolean;
    /** Disables Save (nothing to save, or the form is invalid). */
    saveDisabled?: boolean;
    size?: ModalSize;
    /** Extra lines for About (licence, support link…). */
    about?: React.ReactNode;
    /**
     * The dialog's own title. Defaults to "Settings", which is what every app's
     * dialog is called (fit-and-finish X5); leave it unset.
     */
    title?: string;
    /**
     * One line under the title, for what the dialog as a whole is doing — typically
     * how many values are set on this device rather than inherited.
     */
    summary?: React.ReactNode;
    /**
     * @deprecated No longer draws anything. It used to put an explanation of the
     * scope dot under the title ("● Set on this device. Everything else comes from
     * your account, this boat or a default."), which Craig removed fleet-wide on
     * 2026-10-07 as not needed; each dot keeps its own tooltip. Still accepted so
     * HarborSentinel and OceanSentinel, which pass it, keep compiling.
     */
    scopeLegend?: boolean;
    /**
     * Which layer each built-in Display setting came from.
     *
     * Passed explicitly rather than looked up, so this package stays ignorant of
     * registry key names — it renders chrome, it does not know what a setting is.
     * Every one of these is device-scoped in practice, which is exactly the point
     * worth showing: "keep the screen awake is off" is a fact about one machine,
     * and used to read as a fact about the boat.
     */
    sources?: {
        nightMode?: SettingSource;
        dayBrightness?: SettingSource;
        nightBrightness?: SettingSource;
        keepAwake?: SettingSource;
    };
}
/**
 * The fleet settings dialog: Display (night mode, brightness, keep awake) →
 * the app's own sections → Updates → About. Every app gets the same chrome and
 * the same standard sections, and only supplies what is genuinely its own.
 */
export declare function SettingsShell({ open, onClose, appName, appIcon, version, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, updater, children, tabs, initialTab, initialFocus, displayExtra, footer, onSave, saveLabel, saving, saveDisabled, size, about, summary, sources, title, }: SettingsShellProps): React.JSX.Element;
