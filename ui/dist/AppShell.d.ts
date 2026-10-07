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
    /**
     * @deprecated Ignored. The phone tab bar shows the full `label` (fit-and-finish
     * V8): an abbreviation is a second name for one place. Use `tabLabelPx={12}`
     * on AppShell where the full labels need the room.
     */
    shortLabel?: React.ReactNode;
    icon: React.ReactNode;
    badge?: number;
    /**
     * What this tab shows, when it differs from the shell's `surface`. OceanSentinel's
     * Map tab is a chart and its Forecast, VHF and Log tabs are pages.
     */
    surface?: ShellSurface;
}
export interface HeaderButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Shown alone below `sm`, and wherever there is no `label`. */
    icon: React.ReactNode;
    active?: boolean;
    /** Shown instead of the icon from `sm` up; the icon stands in for it below. */
    label?: React.ReactNode;
}
/**
 * A header control (Night, Settings, Guide, End watch…): Inter 15/600 in
 * sentence case, 48px tall.
 *
 * An icon or a word, never both: the word from `sm` up, where there is room for
 * it, and the icon below, where there is not (fit-and-finish, "Icons": icon and
 * word together belong only to primary navigation). It was mono, letter-spaced
 * and always iconned, which put a third typeface in every header (X1).
 */
export declare function HeaderButton({ icon, active, label, className, ...rest }: HeaderButtonProps): React.JSX.Element;
/**
 * Groups the header's status items. It draws nothing of its own any more: a
 * status is a dot and a word, and the bordered box this used to draw around
 * the pills was a box around a box (fit-and-finish X3). Kept so no app has to
 * change; an app can drop it and pass its StatusPills straight to `headerStatus`.
 *
 * `min-w-0`, and deliberately not `shrink-0`. This group is what the header's
 * status band actually holds, so a group that will not shrink makes the band's
 * own `min-w-0` a lie: the band never gets narrower than the pills, and its
 * `overflow-hidden` guillotines them instead. A flex item will not go below its
 * min-content size either, and a pill's min-content is its whole label because
 * the label does not wrap; `min-w-0` is what overrides that. Shrinking then
 * stops at each child's own floor: `StatusPill` carries a min-width of its dot
 * and padding, so it ellipsises down to a dot and stops.
 */
export declare function HeaderGroup({ children, className }: {
    children: React.ReactNode;
    className?: string;
}): React.JSX.Element;
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
    /**
     * @deprecated Accepted and not rendered. The rail no longer has a footer: the
     * version it held lives in Settings > About only (fit-and-finish O1).
     */
    dockFooter?: React.ReactNode;
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
