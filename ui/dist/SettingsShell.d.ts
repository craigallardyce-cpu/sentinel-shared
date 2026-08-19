import React from 'react';
import { type ModalSize } from './Modal';
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
/** A bordered row inside a section — label/value on the left, control on the right. */
export declare function SettingsRow({ label, description, children, className }: {
    label: React.ReactNode;
    description?: React.ReactNode;
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
}
/**
 * The fleet settings dialog: Display (night mode, brightness, keep awake) →
 * the app's own sections → Updates → About. Every app gets the same chrome and
 * the same standard sections, and only supplies what is genuinely its own.
 */
export declare function SettingsShell({ open, onClose, appName, appIcon, version, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange, nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, updater, children, footer, size, about, }: SettingsShellProps): React.JSX.Element;
