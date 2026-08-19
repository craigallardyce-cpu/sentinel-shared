import React, { useId } from 'react';
import { cn } from './cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  disabled?: boolean;
  /** Put the switch before the label instead of after. */
  switchFirst?: boolean;
  className?: string;
  id?: string;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
}

/**
 * An accessible switch. Renders as a row (label + description on one side, the
 * switch on the other) so settings lists line up without per-row layout code.
 */
export function Toggle({ checked, onChange, label, description, disabled, switchFirst = false, className, id: idProp, 'aria-label': ariaLabel }: ToggleProps) {
  const auto = useId();
  const id = idProp ?? auto;

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        checked ? 'bg-cyan' : 'bg-bg-highest'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full shadow transition-transform duration-200',
          checked ? 'translate-x-5 bg-bg-app' : 'translate-x-0 bg-text-secondary'
        )}
      />
    </button>
  );

  if (!label && !description) return <span className={className}>{control}</span>;

  return (
    <div className={cn('flex items-center justify-between gap-4', switchFirst && 'flex-row-reverse justify-end', className)}>
      <label htmlFor={id} className={cn('min-w-0 cursor-pointer', disabled && 'cursor-not-allowed opacity-60')}>
        {label && <span className="block text-sm text-text-primary">{label}</span>}
        {description && <span className="block text-xs text-text-muted mt-0.5">{description}</span>}
      </label>
      {control}
    </div>
  );
}
