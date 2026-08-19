import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon rendered before the label. Pass a lucide element, e.g. `<Save size={16} />`. */
  icon?: React.ReactNode;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-cyan text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-cyan-glow)]',
  secondary: 'bg-bg-card text-text-primary border border-border-color hover:bg-bg-card-hover hover:border-cyan/50',
  danger: 'bg-red-dim text-red border border-red/40 hover:bg-red/15',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-card-hover',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
};

/**
 * The fleet button. Labels are sentence case ("Save changes", not "SAVE & APPLY").
 * `primary` is for the one main action on a surface; `danger` for destructive
 * actions; everything else is `secondary` or `ghost`.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, block = false, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium select-none whitespace-nowrap transition-[background-color,border-color,filter,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 active:scale-[0.98]',
        VARIANT[variant],
        SIZE[size],
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
