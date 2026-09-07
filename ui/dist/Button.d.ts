import React from 'react';
export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'success' | 'alarm' | 'danger' | 'ghost';
export type ButtonSize = 'dense' | 'sm' | 'md';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Icon rendered before the label. Pass a lucide element, e.g. `<Save size={16} />`. */
    icon?: React.ReactNode;
    /** Shows a spinner and disables the button. */
    loading?: boolean;
    /** Stretch to the container width. */
    block?: boolean;
    /**
     * Drawn lit, for a control that is *on* rather than one that was clicked —
     * a monitored VHF channel, an open panel, a layer showing on the chart.
     *
     * Sets `aria-pressed`, so screen readers announce it as a toggle rather than
     * as a button that happens to look different. Reads over any variant; it is
     * `secondary` and `ghost` that were being hand-rolled for want of it.
     */
    active?: boolean;
}
/**
 * The fleet button. Labels are sentence case ("Save changes", not "SAVE & APPLY"),
 * with one exception: `alarm` labels are the shout they already are on the
 * screens that raise them.
 *
 * `primary` is the one main action on a surface; `accent` a notable secondary
 * one; `success` a completion; `alarm` acknowledging an alarm; `danger` a
 * destructive action; everything else `secondary` or `ghost`.
 */
export declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
