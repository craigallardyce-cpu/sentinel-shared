import React, { useEffect } from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { cn } from './cn';
import { HeaderStatusContext } from './StatusPill';

declare global {
  interface Window {
    /** Exposed by each app's Electron preload; absent on the web and in Capacitor. */
    appShell?: { setNightMode?: (night: boolean) => void };
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
  /** Shown in full in the rail and the phone tab bar; never truncated or abbreviated. */
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
export function HeaderButton({ icon, active = false, label, className, ...rest }: HeaderButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 h-12 min-w-12 px-3 sm:px-4 rounded-md cursor-pointer',
        'font-sans text-[15px] font-semibold whitespace-nowrap',
        'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60',
        active ? 'text-cyan' : 'text-text-secondary hover:text-text-primary hover:bg-bg-card-hover',
        className
      )}
      aria-pressed={active}
      {...rest}
    >
      <span className={cn('shrink-0 [&>svg]:w-5 [&>svg]:h-5', label ? 'sm:hidden' : undefined)} aria-hidden>
        {icon}
      </span>
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

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
export function HeaderGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-4 select-none min-w-0', className)}>{children}</div>;
}

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
  children?: React.ReactNode;
  className?: string;
}

/* Bottom padding of the content area, as a variable the inline style reads.
   The value differs either side of `lg` (the tab bar shows only below it), and
   an inline style cannot hold a breakpoint -- while theme/shell.css's own
   padding is unlayered, so no utility class could override it. Literal strings,
   so each app's Tailwind finds them when it scans this package. */
const CONTENT_PB = {
  chartTabs:
    '[--sentinel-shell-pb:calc(var(--shell-bottom-nav)_+_0.5rem_+_var(--safe-area-bottom,0px))] lg:[--sentinel-shell-pb:calc(1rem_+_var(--safe-area-bottom,0px))]',
  chartNoTabs: '[--sentinel-shell-pb:calc(1rem_+_var(--safe-area-bottom,0px))]',
  pageTabs:
    '[--sentinel-shell-pb:calc(var(--shell-bottom-nav)_+_var(--safe-area-bottom,0px))] lg:[--sentinel-shell-pb:var(--safe-area-bottom,0px)]',
  pageNoTabs: '[--sentinel-shell-pb:var(--safe-area-bottom,0px)]',
};

/** The one hairline a page draws between the window's chrome and its content. */
const PAGE_HAIRLINE = 'border-bg-highest';

/**
 * The fleet application frame: a 56px header, a 72px rail from `lg` (1024px)
 * up, a tab bar below it, safe-area aware on every edge. The rail breakpoint is
 * deliberately `lg`, not `2xl` — tablets are the likeliest plotter form factor
 * and should get the desktop layout.
 *
 * How the frame is drawn depends on `surface`: floating glass over a chart,
 * opaque and attached for a page.
 */
export function AppShell({
  appName,
  brandIcon,
  tabs,
  activeTab,
  onTabChange,
  nightMode = false,
  onToggleNightMode,
  brightness,
  settingsOpen = false,
  onOpenSettings,
  headerCenter,
  headerStatus,
  headerActions,
  background,
  passThrough = false,
  mainClassName,
  bareMain = false,
  surface,
  tabLabelPx = 13,
  children,
  className,
}: AppShellProps) {
  const hasTabs = tabs.length > 0;
  const activeSurface = tabs.find((t) => t.id === activeTab)?.surface;
  const resolved: ShellSurface = activeSurface ?? surface ?? (background ? 'chart' : 'page');
  const chart = resolved === 'chart';

  // Night mode and brightness go on <html>, not this div, so portalled dialogs and
  // toasts (rendered into document.body) are themed and dimmed too. On desktop
  // the OS window-controls cluster (electron-shell's hidden title bar) is told as
  // well, so it turns red with the rest of the screen.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-night', !!nightMode);
    root.style.filter = brightness !== undefined && brightness !== 100 ? `brightness(${brightness}%)` : '';
    window.appShell?.setNightMode?.(!!nightMode);
    return () => {
      root.classList.remove('theme-night');
      root.style.filter = '';
      window.appShell?.setNightMode?.(false);
    };
  }, [nightMode, brightness]);

  /* theme/shell.css lays the content out from three variables. Set here, on the
     same element, an inline value beats its class and media rules, so the
     shell's geometry lives in one place:
       chart  16px from every edge (clear of the OS window controls), 16px
              between the header and what is under it;
       page   flush with the window, directly under the title-bar strip.
     The tab bar is 72px in both. */
  const shellVars = {
    '--shell-edge': chart ? 'max(1rem, calc(env(titlebar-area-height, 0px) + 0.5rem))' : 'env(titlebar-area-height, 0px)',
    '--shell-gap': chart ? '1rem' : '0px',
    '--shell-bottom-nav': '4.5rem',
  } as React.CSSProperties;

  const sideInset = chart ? '1rem' : '0px';

  return (
    <div
      className={cn('sentinel-shell flex flex-col h-dvh w-screen bg-bg-app text-text-primary overflow-hidden font-sans', className)}
      style={shellVars}
      data-surface={resolved}
    >
      <div className="flex-grow flex flex-col min-h-0 overflow-hidden relative">
        {background && <div className="absolute inset-0 z-0">{background}</div>}

        <header
          className={cn(
            'sentinel-header fixed h-14 flex items-center gap-1 z-50 select-none pr-2',
            chart
              ? 'left-4 right-4 rounded-xl glass-panel pl-4 sm:pl-5'
              : cn('left-0 right-0 bg-bg-app border-b pl-4 sm:pl-6', PAGE_HAIRLINE)
          )}
          style={{
            top: 'calc(var(--shell-edge) + var(--safe-area-top, 0px))',
            marginLeft: 'var(--safe-area-left, 0px)',
            marginRight: 'var(--safe-area-right, 0px)',
          }}
        >
          {/*
            Three bands, and two of them give way.

            A flex item's default `min-width: auto` refuses to shrink below its
            content, so a header whose status grew pushed past the panel instead
            of yielding: the brand truncated to nothing, the status drew over it,
            and Settings was clipped off the right edge. The brand and the
            controls are both `shrink-0`; `headerCenter` and the status band are
            ordinary flex children with `min-w-0`, so those two share whatever
            squeeze is left. Whatever else happens, Night and Settings stay
            reachable, because a control you cannot see is worse than a status
            you cannot read.

            `headerCenter` is `flex-auto` rather than centred out of flow: taken
            out of flow it could sit on top of the status band. With the brand
            and controls pinned it fills exactly the space between them, so its
            own `justify-center` still reads as centred when there is room, and
            it shrinks together with the status band when there is not.

            Absorbing the squeeze has to reach the status items themselves:
            `HeaderGroup` shrinks, and each StatusPill ellipsises down to its
            dot rather than being sliced. `overflow-hidden` stays as the last
            resort for content this package cannot see.
          */}
          <div className="flex items-center gap-2.5 shrink-0 min-w-0">
            {brandIcon && <span className="text-cyan shrink-0 [&>svg]:w-5 [&>svg]:h-5" aria-hidden>{brandIcon}</span>}
            <span className="hidden sm:inline font-wordmark font-semibold text-[17px] text-cyan truncate">{appName}</span>
          </div>

          {/*
            `flex-auto` (`flex: 1 1 auto`), not `flex-1` (`flex: 1 1 0%`): with a
            zero flex-basis this band reported no min-content need at all, so the
            shrink algorithm dumped the entire squeeze onto it instead of sharing
            it with the status band next to it.
          */}
          <div className="flex-auto min-w-0 flex items-center justify-center overflow-hidden">
            {headerCenter}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {headerStatus && (
              <div className="flex items-center gap-4 min-w-0 overflow-hidden sm:px-2" data-slot="header-status">
                {/* Below `sm` every StatusPill in here is a dot, its word kept
                    for screen readers (StatusPill's HeaderStatusContext). */}
                <HeaderStatusContext.Provider value={true}>{headerStatus}</HeaderStatusContext.Provider>
              </div>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {onToggleNightMode && (
                <HeaderButton
                  icon={nightMode ? <Sun size={20} /> : <Moon size={20} />}
                  active={nightMode}
                  label={nightMode ? 'Day' : 'Night'}
                  onClick={onToggleNightMode}
                  aria-label={nightMode ? 'Switch to day mode' : 'Switch to night mode'}
                />
              )}
              {onOpenSettings && (
                <HeaderButton icon={<Settings size={20} />} active={settingsOpen} label="Settings" onClick={onOpenSettings} aria-label="Settings" />
              )}
              {headerActions}
            </div>
          </div>
        </header>

        <div
          className={cn(
            'sentinel-shell-content flex-grow flex flex-row min-h-0 overflow-hidden relative z-10',
            chart ? 'gap-4' : 'gap-0',
            !hasTabs && 'sentinel-shell-content--no-tabs',
            hasTabs ? (chart ? CONTENT_PB.chartTabs : CONTENT_PB.pageTabs) : chart ? CONTENT_PB.chartNoTabs : CONTENT_PB.pageNoTabs,
            passThrough && 'pointer-events-none'
          )}
          style={{
            paddingLeft: `calc(${sideInset} + var(--safe-area-left, 0px))`,
            paddingRight: `calc(${sideInset} + var(--safe-area-right, 0px))`,
            paddingBottom: 'var(--sentinel-shell-pb)',
          }}
        >
          {hasTabs && (
            <aside
              className={cn(
                'hidden lg:flex flex-col shrink-0 w-18 h-full p-2 select-none pointer-events-auto',
                chart ? 'glass-panel rounded-xl' : cn('bg-bg-app border-r', PAGE_HAIRLINE)
              )}
            >
              <nav className="flex flex-col gap-1 w-full" aria-label="Primary">
                {tabs.map((tab) => {
                  const active = tab.id === activeTab;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onTabChange(tab.id)}
                      aria-current={active ? 'page' : undefined}
                      title={typeof tab.label === 'string' ? tab.label : undefined}
                      className={cn(
                        'relative flex flex-col items-center justify-center gap-1 min-h-16 w-full px-0.5 py-2 rounded-md cursor-pointer text-center',
                        'font-sans text-[13px] font-semibold leading-4',
                        'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60',
                        active ? 'bg-cyan-dim text-cyan' : 'text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'
                      )}
                    >
                      <span className="shrink-0 [&>svg]:w-5 [&>svg]:h-5" aria-hidden>{tab.icon}</span>
                      {/* The full label, wrapped rather than cut, and broken
                          only where the app says a word may break: at a space,
                          or at a soft hyphen (\u00AD) it put in the label, as in
                          "Main­tenance". No automatic hyphenation and no
                          emergency mid-word break, so a word that is too wide
                          shows as too wide rather than as "Forecas / t". */}
                      <span className="max-w-full hyphens-manual [overflow-wrap:normal]" data-slot="rail-label">{tab.label}</span>
                      {tab.badge !== undefined && tab.badge > 0 && (
                        <span className="absolute top-1 right-1 bg-warning text-bg-app text-[13px] font-mono font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </aside>
          )}

          <main
            className={cn(
              'flex-1 flex flex-col min-h-0 min-w-0 relative',
              !bareMain &&
                (chart
                  ? 'glass-panel rounded-xl p-4 sm:p-5 overflow-y-auto custom-scrollbar'
                  : 'bg-bg-app p-4 sm:p-6 overflow-y-auto custom-scrollbar'),
              mainClassName
            )}
          >
            {children}
          </main>
        </div>

        {hasTabs && (
          <nav
            className={cn(
              'fixed bottom-0 left-0 right-0 grid grid-flow-col auto-cols-fr lg:hidden z-40 select-none px-1 border-t',
              chart ? 'bg-bg-panel/90 backdrop-blur-md border-border-color' : cn('bg-bg-app', PAGE_HAIRLINE)
            )}
            style={{ height: 'calc(var(--shell-bottom-nav) + var(--safe-area-bottom, 0px))', paddingBottom: 'var(--safe-area-bottom, 0px)' }}
            aria-label="Primary"
          >
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-1 min-w-0 px-1 cursor-pointer text-center',
                    'font-sans font-semibold leading-tight',
                    // VesselKeeper's approved exception is 12px below `sm` only, and
                    // the drift checker recognises it only written this way.
                    tabLabelPx === 12 ? 'text-[12px] sm:text-[13px]' : 'text-[13px]',
                    'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan/60',
                    active ? 'text-cyan' : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  <span className="shrink-0 [&>svg]:w-5 [&>svg]:h-5" aria-hidden>{tab.icon}</span>
                  {/* Always the full label: never `shortLabel`, never truncated.
                      A label longer than its column wraps to a second line. */}
                  <span className="max-w-full break-words hyphens-auto" data-slot="tab-label">{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="absolute top-1 right-1 bg-warning text-bg-app text-[13px] font-mono font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
