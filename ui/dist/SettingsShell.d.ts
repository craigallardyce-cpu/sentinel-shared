import React from 'react';
import { type ModalSize } from './Modal';
import type { SettingSource } from './ScopeBadge';
import type { AppUpdater } from './useAppUpdater';
export interface SettingsSectionProps {
    title: React.ReactNode;
    icon?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
}
/** One settings group: eyebrow title with icon, optional one-line description, then rows. */
export declare function SettingsSection({ title, icon, description, children, className }: SettingsSectionProps): React.JSX.Element;
/**
 * One settings row: label and description on the left, control on the right, and
 * — when the caller knows it — a chip saying which layer the value came from.
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
    /** Usually Cancel / Save buttons. */
    footer?: React.ReactNode;
    size?: ModalSize;
    /** Extra lines for About (licence, support link…). */
    about?: React.ReactNode;
    /**
     * One line under the title, for what the dialog as a whole is doing — typically
     * how many values are set on this device rather than inherited.
     */
    summary?: React.ReactNode;
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
export declare function SettingsShell({ open, onClose, appName, appIcon, version, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, updater, children, footer, size, about, summary, sources, }: SettingsShellProps): React.JSX.Element;
