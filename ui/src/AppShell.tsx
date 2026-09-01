import React, { useEffect } from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { cn } from './cn';

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
export function HeaderButton({ icon, active = false, label, className, ...rest }: HeaderButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        // min-h-11 (44px): these are the most-tapped controls in the app and they
        // sit in a 56px header, so the target can be full-height for free.
        'flex items-center gap-1.5 font-mono text-[13px] font-bold tracking-widest transition-colors duration-150 cursor-pointer min-h-11',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 rounded-md px-1',
        active ? 'text-cyan drop-shadow-[0_0_8px_var(--color-cyan-glow)]' : 'text-text-muted hover:text-text-primary',
        className
      )}
      aria-pressed={active}
      {...rest}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

/** Bordered container for a group of status pills in the header. */
export function HeaderGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1 rounded-lg border border-border-color/60 bg-bg-card/50 shadow-inner select-none shrink-0', className)}>
      {children}
    </div>
  );
}

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
  dockFooter,
  background,
  passThrough = false,
  mainClassName,
  bareMain = false,
  children,
  className,
}: AppShellProps) {
  const hasTabs = tabs.length > 0;

  // Night mode and brightness go on <html>, not this div, so portalled dialogs and
  // toasts (rendered into document.body) are themed and dimmed too.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-night', !!nightMode);
    root.style.filter = brightness !== undefined && brightness !== 100 ? `brightness(${brightness}%)` : '';
    return () => {
      root.classList.remove('theme-night');
      root.style.filter = '';
    };
  }, [nightMode, brightness]);

  return (
    <div className={cn('sentinel-shell flex flex-col h-dvh w-screen bg-bg-app text-text-primary overflow-hidden font-sans', className)}>
      <div className="flex-grow flex flex-col min-h-0 overflow-hidden relative">
        {background && <div className="absolute inset-0 z-0">{background}</div>}

        <header
          className="fixed left-2 right-2 sm:left-6 sm:right-6 h-14 rounded-lg sm:rounded-xl glass-panel shadow-2xl flex justify-between items-center z-50 select-none px-4 sm:px-5"
          style={{
            top: 'calc(var(--shell-edge) + var(--safe-area-top, 0px))',
            marginLeft: 'var(--safe-area-left, 0px)',
            marginRight: 'var(--safe-area-right, 0px)',
          }}
        >
          {/*
            Three bands, and only the middle one gives way.

            A flex item's default `min-width: auto` refuses to shrink below its
            content, so a header whose status pills grew — a type scale change
            is enough — pushed past the panel instead of yielding: the brand
            truncated to nothing, the pills drew over it, and Settings was
            clipped off the right edge. The brand and the controls are now both
            `shrink-0`, and the status band carries `min-w-0` so it is the one
            that absorbs the squeeze. Whatever else happens, Night and Settings
            stay reachable, because a control you cannot see is worse than a
            status you cannot read.
          */}
          <div className="flex items-center gap-2 mr-2 shrink-0 min-w-0">
            {brandIcon && <span className="text-cyan shrink-0" aria-hidden>{brandIcon}</span>}
            <span className="hidden sm:inline font-heading font-semibold tracking-wide text-sm text-cyan truncate">{appName}</span>
          </div>

          {headerCenter && <div className="absolute left-1/2 -translate-x-1/2 flex items-center">{headerCenter}</div>}

          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            {headerStatus && (
              <div className="flex items-center gap-3 sm:gap-4 min-w-0 overflow-hidden">{headerStatus}</div>
            )}
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {onToggleNightMode && (
                <HeaderButton
                  icon={nightMode ? <Sun size={13} /> : <Moon size={13} />}
                  active={nightMode}
                  label={nightMode ? 'Day' : 'Night'}
                  onClick={onToggleNightMode}
                  aria-label={nightMode ? 'Switch to day mode' : 'Switch to night mode'}
                />
              )}
              {onOpenSettings && (
                <HeaderButton icon={<Settings size={13} />} active={settingsOpen} label="Settings" onClick={onOpenSettings} aria-label="Settings" />
              )}
              {headerActions}
            </div>
          </div>
        </header>

        <div
          className={cn(
            'sentinel-shell-content flex-grow flex flex-row min-h-0 overflow-hidden relative z-10 gap-4 transition-[padding] duration-300',
            !hasTabs && 'sentinel-shell-content--no-tabs',
            passThrough && 'pointer-events-none'
          )}
        >
          {hasTabs && (
            <aside className="hidden lg:flex flex-col shrink-0 select-none h-full pointer-events-auto">
              <div className="glass-panel rounded-xl w-48 h-full flex flex-col py-5 px-3 shadow-2xl justify-between">
                <nav className="flex flex-col gap-1.5 w-full" aria-label="Primary">
                  {tabs.map((tab) => {
                    const active = tab.id === activeTab;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer w-full text-left border',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60',
                          active
                            ? 'bg-cyan/5 text-cyan border-cyan/70 shadow-[0_0_12px_var(--color-cyan-glow)]'
                            : 'text-text-secondary hover:bg-bg-card-hover hover:text-text-primary border-transparent'
                        )}
                      >
                        <span className="shrink-0 [&>svg]:w-4 [&>svg]:h-4" aria-hidden>{tab.icon}</span>
                        <span className="truncate">{tab.label}</span>
                        {tab.badge !== undefined && tab.badge > 0 && (
                          <span className="ml-auto bg-warning text-bg-app text-[12px] font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center font-mono">
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
                {dockFooter && <div className="px-3 text-[13px] font-mono text-text-muted leading-tight">{dockFooter}</div>}
              </div>
            </aside>
          )}

          <main className={cn('flex-1 flex flex-col min-h-0 min-w-0 relative', !bareMain && 'glass-panel rounded-2xl shadow-2xl p-4 sm:p-5 overflow-y-auto custom-scrollbar', mainClassName)}>
            {children}
          </main>
        </div>

        {hasTabs && (
          <nav
            className="fixed bottom-0 left-0 right-0 bg-bg-panel/90 backdrop-blur-md border-t border-border-color flex lg:hidden justify-around items-center z-40 select-none px-2"
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
                    'flex flex-col items-center justify-center relative cursor-pointer px-3 py-1.5 min-w-14 transition-colors',
                    active ? 'text-cyan' : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  <span className="[&>svg]:w-5 [&>svg]:h-5" aria-hidden>{tab.icon}</span>
                  <span className="text-[12px] mt-1 font-medium">{tab.shortLabel ?? tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="absolute top-0 right-1 bg-warning text-bg-app text-[12px] font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center font-mono">
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
