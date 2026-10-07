import React from 'react';
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
 * Only an override is filled. Everything inherited is hollow, because
 * inheritance is the ordinary case and the thing worth noticing is the value
 * that departs from it.
 *
 * Quiet means quiet. This was a bordered chip in bold uppercase mono, then a
 * muted word, and on a tab where several values are device-set it still put
 * "This device" on row after row (fit-and-finish X5). It is a 6px dot now,
 * beside the label: filled for an override (this device, this PC), hollow for
 * an inherited layer. Neither takes the accent: the override is a filled
 * text-secondary dot, as the Settings boards draw it, because cyan is what the
 * dialog uses for the selected tab and the primary action, and a dot in that
 * colour on row after row read as something to press. The layer's name
 * is still in the element as visually hidden text (`sr-only`), so a screen
 * reader announces it and a caller can still find the badge by its text, and
 * it is in the tooltip, which is the only explanation the dot gets.
 */
export interface ScopeBadgeProps {
    source: SettingSource;
    /** Hides the badge entirely for `default` and `unset`. */
    hideWhenUnset?: boolean;
    className?: string;
}
export declare function ScopeBadge({ source, hideWhenUnset, className }: ScopeBadgeProps): React.JSX.Element | null;
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
export declare function ClearOverride({ fallsBackTo, onClear, disabled, className }: ClearOverrideProps): React.JSX.Element;
