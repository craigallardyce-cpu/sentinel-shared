import React from 'react';
export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'success' | 'alarm' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'dense' | 'sm' | 'md';
/**
 * `default` is the fleet button's own shape. `bare` hands layout to the
 * caller's `className` -- see LAYOUT below for exactly what that means.
 */
export type ButtonLayout = 'default' | 'bare';
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
    /**
     * `bare` drops everything about the button's shape -- display, alignment,
     * justification, height, padding, gap, radius, font size, font weight and
     * wrapping -- so the caller's `className` decides them. The variant keeps
     * its colours, border, hover, focus ring and disabled state. `size` is
     * ignored. For a row with a label left and a count right:
     * `layout="bare" className="w-full flex justify-between items-center px-3 py-2"`.
     */
    layout?: ButtonLayout;
    /**
     * The 44px Android touch minimum, where the caller has taken over the shape.
     * Defaults to on. It applies to `layout="bare"` (as `min-h-11`) and to the
     * `link` variant (as an invisible 44px-tall hit area that does not move
     * anything). `layout="default"` ignores it: there `size` sets the height,
     * and `dense` is under the floor on purpose. Pass `false` only for a control
     * a mouse drives, or one that already has a 44px-tall parent that is itself
     * the target.
     */
    touchFloor?: boolean;
}
/**
 * The fleet button. Labels are sentence case ("Save changes", not "SAVE & APPLY"),
 * with one exception: `alarm` labels are the shout they already are on the
 * screens that raise them.
 *
 * `primary` is the one main action on a surface; `accent` a notable secondary
 * one; `success` a completion; `alarm` acknowledging an alarm; `danger` a
 * destructive action; `link` an action that reads as text; everything else
 * `secondary` or `ghost`. `layout="bare"` hands the shape to `className`.
 */
export declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
