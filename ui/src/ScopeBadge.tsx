import React from 'react';
import { cn } from './cn';

/**
 * Where a setting's value came from.
 *
 * The same six values `@sentinel/settings` reports from `resolve().source`,
 * declared here as a plain union rather than imported: a string union is not
 * worth a dependency between two shared packages, and one satisfies the other on
 * sight.
 */
export type SettingSource = 'account' | 'vessel' | 'host' | 'device' | 'default' | 'unset';

/**
 * A small chip saying which layer answered.
 *
 * This is the one thing a settings dialog could never say before. Every value on
 * the screen used to look identical whether it belonged to the boat, to the
 * account, or to this machine alone — so "keep the screen awake is off" read as a
 * fact about the boat when it was a fact about one laptop, and a navigator had no
 * way to tell that changing the gateway here would or would not reach the PC at
 * the nav station.
 *
 * Only an override is drawn in the accent colour. Everything inherited is quiet,
 * because inheritance is the ordinary case and the thing worth noticing is the
 * value that departs from it.
 *
 * Quiet means quiet. This was a bordered chip in bold uppercase mono, then a
 * muted word, and on a tab where several values are device-set it still put
 * "This device" on row after row (fit-and-finish X5). It is a 6px dot now,
 * beside the label: filled for an override (this device, this PC), hollow for
 * an inherited layer. The layer's name is the dot's accessible name and its
 * tooltip, so it is still announced, and the dialog explains the dot once, in
 * its header (SettingsShell's `scopeLegend`).
 */
export interface ScopeBadgeProps {
  source: SettingSource;
  /** Hides the badge entirely for `default` and `unset`. */
  hideWhenUnset?: boolean;
  className?: string;
}

const LABEL: Record<SettingSource, string> = {
  account: 'Account',
  vessel: 'Boat',
  host: 'This PC',
  device: 'This device',
  default: 'Default',
  unset: 'Not set',
};

const DESCRIPTION: Record<SettingSource, string> = {
  account: 'Set for your account — applies on every device you sign in on.',
  vessel: 'Set for this boat — shared with the other MarinerSentinel apps.',
  host: 'Set on the machine running the backend, shared by everything pointed at it.',
  device: 'Set on this device only, overriding anything broader.',
  default: 'Nobody has changed this; it is the value the app ships with.',
  unset: 'Nobody has set this yet.',
};

export function ScopeBadge({ source, hideWhenUnset = false, className }: ScopeBadgeProps) {
  if (hideWhenUnset && (source === 'default' || source === 'unset')) return null;

  // Narrower than the layers beneath it, so it is the one worth pointing at.
  const isOverride = source === 'device' || source === 'host';

  return (
    <span
      role="img"
      aria-label={LABEL[source]}
      title={`${LABEL[source]}: ${DESCRIPTION[source]}`}
      data-source={source}
      className={cn(
        'inline-block shrink-0 h-1.5 w-1.5 rounded-full align-middle',
        isOverride ? 'bg-text-secondary' : 'border border-text-muted',
        className
      )}
    />
  );
}

/**
 * "Clear override" — offered only where clearing would actually reveal something.
 *
 * A device value with nothing broader behind it is not an override, it is the
 * only answer there is, and a button promising to fall back to a value that does
 * not exist would be a lie.
 */
export interface ClearOverrideProps {
  /** What the value would fall back to, for the label. */
  fallsBackTo: SettingSource;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
}

export function ClearOverride({ fallsBackTo, onClear, disabled, className }: ClearOverrideProps) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={disabled}
      title={`Remove this device's value and use the ${LABEL[fallsBackTo].toLowerCase()} one instead.`}
      className={cn(
        'shrink-0 h-10 px-3 rounded-md text-[13px] font-semibold text-text-secondary',
        'hover:text-text-primary hover:bg-bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        className
      )}
    >
      Clear override
    </button>
  );
}
