import React from 'react';
declare global {
    interface Window {
        /** Exposed by each app's Electron preload; absent on the web and in Capacitor. */
        appShell?: {
            setNightMode?: (night: boolean) => void;
        };
    }
}
export interface ShellTab {
    id: string;
    label: React.ReactNode;
    /** Short label for the bottom bar on phones. */
    shortLabel?: React.ReactNode;
    icon: React.ReactNode;
    badge?: number;
}
export interface HeaderButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: React.ReactNode;
    active?: boolean;
    /** Hidden below `sm`; the icon always shows. */
    label?: React.ReactNode;
}
/** Quiet mono text button used in the header (Night / Settings / Install…). */
export declare function HeaderButton({ icon, active, label, className, ...rest }: HeaderButtonProps): React.JSX.Element;
/** Bordered container for a group of status pills in the header. */
export declare function HeaderGroup({ children, className }: {
    children: React.ReactNode;
    className?: string;
}): React.JSX.Element;
export interface AppShellProps {
    appName: string;
    /** Brand glyph before the name, e.g. `<Waves size={16} />`. */
    brandIcon?: React.ReactNode;
    tabs: ShellTab[];
    activeTab: string;
    onTabChange: (id: string) => void;
    nightMode?: boolean;
    onToggleNightMode?: () => void;
    /** 0–100. Applied as a CSS brightness filter on the whole app. */
    brightness?: number;
    settingsOpen?: boolean;
    onOpenSettings?: () => void;
    /** Rendered in the centre of the header (e.g. a live meter). */
    headerCenter?: React.ReactNode;
    /** Status pills, rendered left of the Night/Settings buttons. */
    headerStatus?: React.ReactNode;
    /** Extra controls rendered right of the Settings button (alarm mute, install…). */
    headerActions?: React.ReactNode;
    /** Rendered at the bottom of the dock (version line etc.). */
    dockFooter?: React.ReactNode;
    /** Full-bleed layer behind everything (a chart). Pointer events pass through the content when `passThrough` is set. */
    background?: React.ReactNode;
    /** Let clicks reach `background` through the content area (the active view renders nothing). */
    passThrough?: boolean;
    /** Class for the main content container. Default gives a glass panel. */
    mainClassName?: string;
    /** Render the main area without the glass panel chrome. */
    bareMain?: boolean;
    children?: React.ReactNode;
    className?: string;
}
/**
 * The fleet application frame: floating glass header, left dock from `lg`
 * (1024px) up, bottom bar below it, safe-area aware on every edge. The dock
 * breakpoint is deliberately `lg`, not `2xl` — tablets are the likeliest
 * plotter form factor and should get the desktop layout.
 */
export declare function AppShell({ appName, brandIcon, tabs, activeTab, onTabChange, nightMode, onToggleNightMode, brightness, settingsOpen, onOpenSettings, headerCenter, headerStatus, headerActions, dockFooter, background, passThrough, mainClassName, bareMain, children, className, }: AppShellProps): React.JSX.Element;
