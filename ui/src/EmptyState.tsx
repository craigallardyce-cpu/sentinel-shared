import React from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  /** A lucide icon element, e.g. `<Radio size={28} />`. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** One or two sentences: what would normally be here and how to get it. */
  description?: React.ReactNode;
  /** Usually a `<Button>`. */
  action?: React.ReactNode;
  /** `panel` draws the dashed frame (for a whole empty pane); `inline` is a quiet centred block for a table body or list. */
  variant?: 'panel' | 'inline';
  className?: string;
}

/**
 * The one empty state. Says what is missing and what to do about it, in the
 * same shape everywhere — not a bare italic sentence in one place and an
 * illustrated block in another.
 */
export function EmptyState({ icon, title, description, action, variant = 'panel', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        variant === 'panel' ? 'rounded-xl border border-dashed border-border-color px-6 py-10 h-full min-h-40' : 'px-4 py-8',
        className
      )}
    >
      {icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-card text-text-muted" aria-hidden>
          {icon}
        </span>
      )}
      <p className="font-heading font-semibold text-sm text-text-primary">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs text-text-muted leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
