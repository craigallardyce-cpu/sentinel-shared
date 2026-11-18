import React from 'react';
declare global {
    interface Window {
        /** Exposed by each app's Electron preload; absent on the web and in Capacitor. */
        appShell?: {
            setNightMode?: (night: boolean) => void;
        };
    }
}
/**
 * What the content area shows, which decides how the shell draws around it
 * (fit-and-finish X8, X9):
 *
 * - `chart`: a chart fills the window behind everything. The header and the
 *   rail float over it as glass panels, 16px in from the edges, because over a
 *   chart a translucent surface keeps the water visible and that does a job.
 * - `page`: anything else. The header and rail are opaque, attached to the
 *   window's edges, and the content is full-bleed on `--bg-app`, with at most
 *   one hairline between the window and the content. Glass over nothing is
 *   ornament.
 */
export type ShellSurface = 'chart' | 'page';
export interface ShellTab {
    id: string;
    /**
     * Shown in full in the rail and the phone tab bar; never abbreviated. The tab
     * bar keeps it on one line and ellipsises it only when large system text
     * leaves no room, with the full text still the accessible name.
     */
    label: React.ReactNode;
    icon: React.ReactNode;
    badge?: number;
    /**
     * What this tab shows, when it differs from the shell's `surface`. OceanSentinel's
     * Map tab is a chart and its Forecast, VHF and Log tabs are pages.
     */
    surface?: ShellSurface;
}
/**
 * How much the header has had to give up to fit its controls on one line.
 *
 * - `full`: words on the header buttons from `sm` up, icons below it (the
 *   layout as designed).
 * - `icons`: the words did not fit, so every header button is its icon at any
 *   width, the word kept for screen readers.
 * - `tight`: icons were not enough either, so the wordmark goes too (the brand
 *   glyph stays) and an app may shorten its own header items.
 *
 * AppShell measures this rather than guessing it from a breakpoint, because
 * Android's WebView scales text with the system font size while every box keeps
 * its width: a portrait tablet at 736px with 130% text overflowed by 80px, the
 * watch state off the right edge (Craig, 17 Nov 2026), while the same tablet at
 * 100% fits with room to spare.
 */
export type HeaderFit = 'full' | 'icons' | 'tight';
/** The header's current fit, for an app's own `headerActions` items. `full` outside a header. */
export declare function useHeaderFit(): HeaderFit;
/**
 * The room a status band keeps when the header is squeezed: its own 8px sides
 * and a StatusPill standing as its dot (the pill's 32px floor). The status
 * band gives way before the controls do, but not to nothing --
 * HarborSentinel's Instruments dot is the connection state and has to show.
 * At 736px with 100% text that is what tips HarborSentinel's watch header into
 * icons: the words fitted only by cutting the dot off.
 */
export declare const HEADER_STATUS_FLOOR_PX = 48;
export interface HeaderLabelProps {
    /** Shown alone below `sm`, and whenever the header has had to give up words. */
    icon: React.ReactNode;
    /** Shown instead of the icon from `sm` up while the header fits it. */
    label?: React.ReactNode;
}
/**
 * The icon-or-word pair every header control draws (HeaderButton's own
 * content), for an app's header item that is not a HeaderButton, such as
 * OceanSentinel's "Muted". Follows the header's fit: the word from `sm` up
 * while it fits, the icon otherwise, with the word kept for screen readers.
 */
export declare function HeaderLabel({ icon, label }: HeaderLabelProps): React.JSX.Element;
export interface HeaderButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Shown alone below `sm`, wherever there is no `label`, and when the header has had to give up words. */
    icon: React.ReactNode;
    active?: boolean;
    /** Shown instead of the icon from `sm` up, while the header has room; the icon stands in for it otherwise. */
    label?: React.ReactNode;
}
/**
 * A header control (Night, Settings, Guide, End watch…): Inter 15/600 in
 * sentence case, 48px tall.
 *
 * An icon or a word, never both: the word from `sm` up, where there is usually
 * room for it, and the icon below, where there is not (fit-and-finish, "Icons":
 * icon and word together belong only to primary navigation). It was mono,
 * letter-spaced and always iconned, which put a third typeface in every header
 * (X1). When the words do not fit even from `sm` up (large system text on a
 * portrait tablet), AppShell switches every header button to its icon; see
 * `HeaderFit`.
 */
export declare function HeaderButton({ icon, active, label, className, ...rest }: HeaderButtonProps): React.JSX.Element;
export interface AppShellProps {
    appName: string;
    /** Brand glyph before the name, e.g. `<Waves />`. Drawn at 20px. */
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
    /** Status items (StatusPills), rendered left of the Night/Settings buttons. */
    headerStatus?: React.ReactNode;
    /** Extra controls rendered right of the Settings button (alarm mute, install…). */
    headerActions?: React.ReactNode;
    /** Full-bleed layer behind everything (a chart). Pointer events pass through the content when `passThrough` is set. */
    background?: React.ReactNode;
    /** Let clicks reach `background` through the content area (the active view renders nothing). */
    passThrough?: boolean;
    /** Class for the main content container. */
    mainClassName?: string;
    /** Render the main area without any chrome of its own (no glass panel, no padding, no scroll). */
    bareMain?: boolean;
    /**
     * What the content is; see `ShellSurface`. The active tab's own `surface`
     * wins over this.
     *
     * Default: `chart` when a `background` is rendered, `page` when there is
     * none. That keeps every chart screen exactly as it was with no app change
     * (HarborSentinel's watch and OceanSentinel's Map both pass the chart as
     * `background`), and moves every other screen off glass it had nothing
     * behind.
     */
    surface?: ShellSurface;
    /**
     * The phone tab bar's label size. 13px (the fleet's reading floor) by
     * default; 12 is the one approved exception, for VesselKeeper's phone layout,
     * where four full labels have to fit.
     */
    tabLabelPx?: 12 | 13;
    /**
     * Where the primary navigation lives.
     *
     * - `responsive` (default): the bottom tab bar below `lg`, the 72px side rail
     *   from `lg` up.
     * - `bottom`: the bottom tab bar at every size, and no rail. OceanSentinel
     *   uses it (Craig, 5 Oct 2026): its chart wants the full width at every
     *   size, and its four tabs sit at the foot of the screen on a plotter as on
     *   a phone.
     */
    nav?: 'responsive' | 'bottom';
    children?: React.ReactNode;
    className?: string;
}
/**
 * The fleet application frame: a 56px header, a 72px rail from `lg` (1024px)
 * up, a tab bar below it, safe-area aware on every edge. The rail breakpoint is
 * deliberately `lg`, not `2xl` — tablets are the likeliest plotter form factor
 * and should get the desktop layout.
 *
 * How the frame is drawn depends on `surface`: floating glass over a chart,
 * opaque and attached for a page.
 */
export declare function AppShell({ appName, brandIcon, tabs, activeTab, onTabChange, nightMode, onToggleNightMode, brightness, settingsOpen, onOpenSettings, headerCenter, headerStatus, headerActions, background, passThrough, mainClassName, bareMain, surface, tabLabelPx, nav, children, className, }: AppShellProps): React.JSX.Element;
