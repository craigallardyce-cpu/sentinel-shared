import React from 'react';
import { cn } from './cn';
import { Modal, type ModalSize } from './Modal';
import { Toggle } from './Toggle';
import { Stepper } from './Stepper';
import { UpdatePanel } from './UpdatePanel';
import { ScopeBadge } from './ScopeBadge';
import type { SettingSource } from './ScopeBadge';
import { Tabs } from './Tabs';
import { Button } from './Button';
import type { AppUpdater } from './useAppUpdater';

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

export interface SettingsSectionProps {
  title: React.ReactNode;
  /**
   * @deprecated Accepted and not drawn. An icon beside a word belongs only to
   * primary navigation (fit-and-finish, "Icons"); a group heading is a word.
   */
  icon?: React.ReactNode;
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
export function SettingsSection({ title, description, children, className, hideTitle = false }: SettingsSectionProps) {
  return (
    <section className={cn('flex flex-col', className)} aria-label={hideTitle && typeof title === 'string' ? title : undefined}>
      {(!hideTitle || description) && (
        <header className="pb-1">
          {!hideTitle && <h3 className="font-sans text-[13px] font-semibold leading-[18px] text-text-muted">{title}</h3>}
          {description && <p className={cn('text-[13px] text-text-muted', !hideTitle && 'mt-1')}>{description}</p>}
        </header>
      )}
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * One settings row: label and description on the left, control on the right,
 * and -- when the caller knows it -- a dot saying which layer the value came from.
 *
 * Flat: no box of its own. Rows are separated by a hairline, and the last row
 * in a group has none.
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
    <div className={cn('flex items-center justify-between gap-6 py-4', ROW_DIVIDER, className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-sans text-[15px] font-semibold text-text-primary">{label}</span>
          {source && <ScopeBadge source={source} hideWhenUnset />}
        </div>
        {description && <div className="text-[13px] text-text-muted mt-1">{description}</div>}
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
  /** @deprecated Accepted and not drawn: tabs are words (fit-and-finish V9). */
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
  displayExtra,
  footer,
  onSave,
  saveLabel = 'Save and apply',
  saving = false,
  saveDisabled = false,
  size = 'lg',
  about,
  summary,
  sources,
  title = 'Settings',
}: SettingsShellProps) {
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

  const updatesSection = updater ? (
    <SettingsSection title="Updates">
      <UpdatePanel updater={updater} className={cn('py-4', ROW_DIVIDER)} />
    </SettingsSection>
  ) : null;

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
  const combinedAbout = updatesSection ? (
    <div className="space-y-6">
      {renderAbout({ appName, appIcon, shownVersion: undefined, about }, inTabs)}
      {updatesSection}
    </div>
  ) : inTabs ? renderAbout({ appName, appIcon, shownVersion, about }, true) : aboutSection;

  const allTabs: SettingsTab[] = tabs
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
  const footerContent = onSave ? (
    <>
      {footer && <div className="mr-auto flex flex-wrap items-center gap-2">{footer}</div>}
      <Button variant="primary" onClick={onSave} loading={saving} disabled={saveDisabled}>
        {saveLabel}
      </Button>
    </>
  ) : footer;

  if (tabs) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        description={summary}
        size={size}
        footer={footerContent}
        subheader={
          <Tabs
            items={allTabs.map((t) => ({ id: t.id, label: t.label }))}
            value={activeId}
            onChange={setActiveTab}
            aria-label="Settings sections"
            idPrefix="settings"
            className="px-4"
          />
        }
      >
        {/* Panels stay mounted. A tab holding a half-filled Telegram token must
            not lose it because someone looked at Units. */}
        {allTabs.map((t) => (
          <div
            key={t.id}
            id={`settings-panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${t.id}`}
            hidden={t.id !== activeId}
          >
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
      size={size}
      footer={footerContent}
      bodyClassName="space-y-8"
    >
      {displaySection}

      {children}

      {updatesSection}

      {aboutSection}
    </Modal>
  );
}

/** A label with its scope dot, as the brightness pair draws it. */
function BrightnessLabel({ children, source }: { children: React.ReactNode; source?: SettingSource }) {
  return (
    <span className="flex items-center gap-2 font-sans text-[15px] font-semibold text-text-primary">
      {children}
      {source && <ScopeBadge source={source} hideWhenUnset />}
    </span>
  );
}

/** The fleet's standard Display group, shared by both layouts. */
function renderDisplay({
  appName, nightMode, onNightModeChange, dayBrightness, onDayBrightnessChange,
  nightBrightness, onNightBrightnessChange, keepAwake, onKeepAwakeChange, sources, displayExtra,
}: Pick<SettingsShellProps,
  'appName' | 'nightMode' | 'onNightModeChange' | 'dayBrightness' | 'onDayBrightnessChange' |
  'nightBrightness' | 'onNightBrightnessChange' | 'keepAwake' | 'onKeepAwakeChange' | 'sources' |
  'displayExtra'>, hideTitle = false) {
  /* Both brightness steppers are drawn in the accent. Night brightness used to
     be red, which is the alarm colour doing a slider's job in day mode (X2);
     at night the accent is red-shifted anyway. */
  const stepperSurface = 'border-border-color bg-transparent hover:bg-bg-card-hover';
  return (
    <SettingsSection title="Display" hideTitle={hideTitle}>
      {onNightModeChange && (
        <SettingsRow label="Night mode" description="Red-shifted palette that preserves night vision." source={sources?.nightMode}>
          <Toggle checked={!!nightMode} onChange={onNightModeChange} aria-label="Night mode" />
        </SettingsRow>
      )}
      {(onDayBrightnessChange || onNightBrightnessChange) && (
        <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 py-4', ROW_DIVIDER)}>
          {onDayBrightnessChange && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-baseline gap-2">
                <BrightnessLabel source={sources?.dayBrightness}>Day brightness</BrightnessLabel>
                <span className="font-mono text-[15px] font-medium text-text-primary tabular-nums">{dayBrightness ?? 100}%</span>
              </div>
              <Stepper
                min={20}
                max={100}
                step={5}
                value={dayBrightness ?? 100}
                onChange={onDayBrightnessChange}
                surfaceClassName={stepperSurface}
                trackClassName="bg-bg-highest"
              />
            </div>
          )}
          {onNightBrightnessChange && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-baseline gap-2">
                <BrightnessLabel source={sources?.nightBrightness}>Night brightness</BrightnessLabel>
                <span className="font-mono text-[15px] font-medium text-text-primary tabular-nums">{nightBrightness ?? 100}%</span>
              </div>
              <Stepper
                min={10}
                max={100}
                step={5}
                value={nightBrightness ?? 100}
                onChange={onNightBrightnessChange}
                surfaceClassName={stepperSurface}
                trackClassName="bg-bg-highest"
              />
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
      {/* Straight after keep-awake, because that is what it depends on. */}
      {displayExtra}
    </SettingsSection>
  );
}

/** About, shared by both layouts. */
function renderAbout({
  appName, appIcon, shownVersion, about,
}: { appName: string; appIcon?: React.ReactNode; shownVersion?: string; about?: React.ReactNode },
  hideTitle = false) {
  return (
    <SettingsSection title="About" hideTitle={hideTitle}>
      <div className={cn('flex items-start gap-3 py-4', ROW_DIVIDER)}>
        {appIcon && <span className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-dim text-cyan shrink-0">{appIcon}</span>}
        <div className="min-w-0 text-[13px]">
          <p className="font-sans text-[15px] font-semibold text-text-primary">
            {appName} {shownVersion && <span className="font-mono font-medium text-text-muted">v{shownVersion}</span>}
          </p>
          <p className="text-text-muted mt-1">
            Part of the MarinerSentinel fleet ·{' '}
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
