import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
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

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-cyan text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-cyan-glow)]',
  secondary: 'bg-bg-card text-text-primary border border-border-color hover:bg-bg-card-hover hover:border-cyan/50',
  danger: 'bg-red-dim text-red border border-red/40 hover:bg-red/15',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-card-hover',
};

/**
 * All three apps ship an Android build, where 44px is the working minimum for
 * anything a wet thumb has to hit. `md` is that 44px; `sm` is 40px and is for
 * dense chrome (toolbars, table rows), not for a primary action.
 */
const SIZE: Record<ButtonSize, string> = {
  // Below the touch floor on purpose. `dense` is for chrome a mouse drives —
  // a table row's inline actions, a compact list header — where a 40px control
  // would push the row apart. Never make it the only way to do something on a
  // phone: give the same action an `sm` or `md` control there.
  dense: 'h-8 px-2 text-[12px] gap-1 rounded-md',
  sm: 'h-10 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-11 px-4 text-sm gap-2 rounded-lg',
};

/**
 * The lit state, matching @sentinel/theme's `.glass-btn-active`, which the
 * header and dock already use — so a toggled Button and a toggled dock item
 * read as the same thing.
 */
const ACTIVE = 'bg-cyan-dim border border-cyan text-cyan shadow-[0_0_12px_var(--color-cyan-glow)] hover:bg-cyan-dim';

/**
 * The fleet button. Labels are sentence case ("Save changes", not "SAVE & APPLY").
 * `primary` is for the one main action on a surface; `danger` for destructive
 * actions; everything else is `secondary` or `ghost`.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, block = false, active, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'inline-flex items-center justify-center font-medium select-none whitespace-nowrap transition-[background-color,border-color,filter,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 active:scale-[0.98]',
        VARIANT[variant],
        SIZE[size],
        // After the variant, so a lit control wins over its resting colours.
        active && ACTIVE,
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 16} aria-hidden /> : icon}
      {children}
    </button>
  );
});
