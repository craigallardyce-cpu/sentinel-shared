import React from 'react';
import { Download, Info, Monitor, Settings as SettingsIcon } from 'lucide-react';
import { cn } from './cn';
import { Modal, type ModalSize } from './Modal';
import { Toggle } from './Toggle';
import { Stepper } from './Stepper';
import { UpdatePanel } from './UpdatePanel';
import { ScopeBadge } from './ScopeBadge';
import type { SettingSource } from './ScopeBadge';
import type { AppUpdater } from './useAppUpdater';

export interface SettingsSectionProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * One settings group: eyebrow title with icon, optional one-line description, then rows.
 *
 * Scope badges throughout this dialog are drawn only where a value actually
 * departs from its default. Showing "DEFAULT" beside every untouched field put a
 * chip on nearly every row, which made a genuinely interesting one — "THIS
 * DEVICE" on a value that is not shared with the boat — read as more of the same
 * noise. The dialog's summary line carries the legend for all of them.
 */
export function SettingsSection({ title, icon, description, children, className }: SettingsSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      <header>
        <h3 className="flex items-center gap-2 text-[13px] font-mono font-bold uppercase tracking-wider text-cyan">
          {icon && <span className="shrink-0" aria-hidden>{icon}</span>}
          {title}
        </h3>
        {description && <p className="text-xs text-text-muted mt-1">{description}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * One settings row: label and description on the left, control on the right, and
 * — when the caller knows it — a chip saying which layer the value came from.
 */
export function SettingsRow({
  label,
  description,
  source,
  action,
  children,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Which layer answered. Omit where provenance is not knowable or not useful. */
  source?: SettingSource;
  /** Usually a Clear override button. */
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary">{label}</span>
          {source && <ScopeBadge source={source} hideWhenUnset />}
        </div>
        {description && <div className="text-xs text-text-muted mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {action}
        {children}
      </div>
    </div>
  );
}

export interface SettingsTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
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
  /** Usually Cancel / Save buttons. */
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Extra lines for About (licence, support link…). */
  about?: React.ReactNode;
  /**
   * The dialog's own title. Defaults to "Settings".
   *
   * HarborSentinel names it "Device & account", because it also has a phone tab
   * of watch limits and two things called Settings was the whole of that app's
   * navigation confusion.
   */
  title?: string;
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
export function SettingsShell({
  open,
  onClose,
  appName,
  appIcon,
  version,
  nightMode,
  onNightModeChange,
  dayBrightness,
  onDayBrightnessChange,
  nightBrightness,
  onNightBrightnessChange,
  keepAwake,
  onKeepAwakeChange,
  updater,
  children,
  tabs,
  footer,
  size = 'lg',
  about,
  summary,
  sources,
  title = 'Settings',
}: SettingsShellProps) {
  const showDisplay = onNightModeChange || onDayBrightnessChange || onNightBrightnessChange || onKeepAwakeChange;
  const shownVersion = updater?.state.currentVersion || version;

  const displaySection = showDisplay ? renderDisplay({
    appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange,
    nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources,
  }) : null;

  const updatesSection = updater ? (
    <SettingsSection title="Updates" icon={<Download size={12} />}>
      <UpdatePanel updater={updater} className="p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl" />
    </SettingsSection>
  ) : null;

  const aboutSection = renderAbout({ appName, appIcon, shownVersion, about });

  /* Tabbed mode. The shell's own three join the app's rather than sitting
     outside them, so every section in the dialog is reachable the same way. */
  const allTabs: SettingsTab[] = tabs
    ? [
        ...(displaySection ? [{ id: '__display', label: 'Display', icon: <Monitor size={12} />, content: displaySection }] : []),
        ...tabs,
        ...(updatesSection ? [{ id: '__updates', label: 'Updates', icon: <Download size={12} />, content: updatesSection }] : []),
        { id: '__about', label: 'About', icon: <Info size={12} />, content: aboutSection },
      ]
    : [];

  const [activeTab, setActiveTab] = React.useState(() => allTabs[0]?.id ?? '');
  const activeId = allTabs.some((t) => t.id === activeTab) ? activeTab : allTabs[0]?.id;

  if (tabs) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        description={summary}
        icon={<SettingsIcon size={18} />}
        size={size}
        footer={footer}
        bodyClassName="space-y-5"
      >
        <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border-color/40">
          {allTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={t.id === activeId}
              aria-controls={`settings-panel-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-t-lg text-[13px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer border-b-2 -mb-px',
                t.id === activeId
                  ? 'border-cyan text-cyan'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              )}
            >
              {t.icon && <span className="shrink-0" aria-hidden>{t.icon}</span>}
              {t.label}
            </button>
          ))}
        </div>

        {/* Panels stay mounted. A tab holding a half-filled Telegram token must
            not lose it because someone looked at Units. */}
        {allTabs.map((t) => (
          <div key={t.id} id={`settings-panel-${t.id}`} role="tabpanel" hidden={t.id !== activeId}>
            {t.content}
          </div>
        ))}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={summary}
      icon={<SettingsIcon size={18} />}
      size={size}
      footer={footer}
      bodyClassName="space-y-8"
    >
      {displaySection}

      {children}

      {updatesSection}

      {aboutSection}
    </Modal>
  );
}

/** The fleet's standard Display group, shared by both layouts. */
function renderDisplay({
  appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange,
  nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources,
}: Pick<SettingsShellProps,
  'appName' | 'nightMode' | 'onNightModeChange' | 'dayBrightness' | 'onDayBrightnessChange' |
  'nightBrightness' | 'onNightBrightnessChange' | 'keepAwake' | 'onKeepAwakeChange' | 'sources'>) {
  return (
    <SettingsSection title="Display" icon={<Monitor size={12} />}>
      {onNightModeChange && (
        <SettingsRow label="Night mode" description="Red-shifted palette that preserves night vision." source={sources?.nightMode}>
          <Toggle checked={!!nightMode} onChange={onNightModeChange} aria-label="Night mode" />
        </SettingsRow>
      )}
      {(onDayBrightnessChange || onNightBrightnessChange) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {onDayBrightnessChange && (
            <div className="p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs gap-2">
                <span className="text-text-secondary flex items-center gap-2">
                  Day brightness
                  {sources?.dayBrightness && <ScopeBadge source={sources.dayBrightness} hideWhenUnset />}
                </span>
                <span className="font-mono font-bold text-cyan">{dayBrightness ?? 100}%</span>
              </div>
              <Stepper min={20} max={100} step={5} value={dayBrightness ?? 100} onChange={onDayBrightnessChange} />
            </div>
          )}
          {onNightBrightnessChange && (
            <div className="p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs gap-2">
                <span className="text-text-secondary flex items-center gap-2">
                  Night brightness
                  {sources?.nightBrightness && <ScopeBadge source={sources.nightBrightness} hideWhenUnset />}
                </span>
                <span className="font-mono font-bold text-red">{nightBrightness ?? 100}%</span>
              </div>
              <Stepper min={10} max={100} step={5} value={nightBrightness ?? 100} onChange={onNightBrightnessChange} colorClass="text-red" />
            </div>
          )}
        </div>
      )}
      {onKeepAwakeChange && (
        <SettingsRow
          label="Keep the screen awake"
          description={`Stops the device sleeping while ${appName} is open.`}
          source={sources?.keepAwake}
        >
          <Toggle checked={!!keepAwake} onChange={onKeepAwakeChange} aria-label="Keep the screen awake" />
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

/** About, shared by both layouts. */
function renderAbout({
  appName, appIcon, shownVersion, about,
}: { appName: string; appIcon?: React.ReactNode; shownVersion?: string; about?: React.ReactNode }) {
  return (
    <SettingsSection title="About" icon={<Info size={12} />}>
      <div className="flex items-center gap-3 p-3.5 bg-bg-panel/40 border border-border-color/30 rounded-xl">
        {appIcon && <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan/10 text-cyan shrink-0">{appIcon}</span>}
        <div className="min-w-0 text-xs">
          <p className="text-sm font-heading font-semibold text-text-primary">
            {appName} {shownVersion && <span className="font-mono font-normal text-text-muted">v{shownVersion}</span>}
          </p>
          <p className="text-text-muted mt-0.5">
            Part of the Mariner Sentinel fleet ·{' '}
            <a href="https://marinersentinel.com" target="_blank" rel="noreferrer" className="text-cyan hover:underline">
              marinersentinel.com
            </a>
          </p>
          {about}
        </div>
      </div>
    </SettingsSection>
  );
}
