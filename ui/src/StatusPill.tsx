import React from 'react';
import { cn } from './cn';

/**
 * The fleet status vocabulary. Anything that carries state uses one of these,
 * so green/amber/red mean the same thing in every app and survive night mode:
 *   ok       — healthy, connected, safe
 *   warning  — degraded, acquiring, due soon, acknowledged alarm
 *   alarm    — failed, overdue, alarm active
 *   offline  — disconnected, disabled, unknown
 *   info     — neutral informational state (uses the accent; not a health state)
 */
export type Status = 'ok' | 'warning' | 'alarm' | 'offline' | 'info';

export const STATUS_CLASS: Record<Status, { text: string; dot: string; bg: string; border: string }> = {
  ok: { text: 'text-green', dot: 'bg-green', bg: 'bg-green/10', border: 'border-green/30' },
  warning: { text: 'text-warning', dot: 'bg-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
  alarm: { text: 'text-red', dot: 'bg-red', bg: 'bg-red/10', border: 'border-red/40' },
  offline: { text: 'text-text-muted', dot: 'bg-text-muted', bg: 'bg-bg-card', border: 'border-border-color' },
  info: { text: 'text-cyan', dot: 'bg-cyan', bg: 'bg-cyan/10', border: 'border-cyan/30' },
};

export interface StatusPillProps {
  status: Status;
  children?: React.ReactNode;
  /** Animate the dot (for live/active states like "listening" or an unacknowledged alarm). */
  pulse?: boolean;
  /** Dot only, no label — for tight HUD spots. Provide `title` for a tooltip. */
  compact?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

export function StatusPill({ status, children, pulse = false, compact = false, size = 'sm', className, title }: StatusPillProps) {
  const c = STATUS_CLASS[status];
  const dot = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      {pulse && <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', c.dot)} />}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', c.dot)} />
    </span>
  );
  if (compact) {
    return (
      <span className={cn('inline-flex items-center', className)} title={title} role="img" aria-label={title ?? status}>
        {dot}
      </span>
    );
  }
  return (
    <span
      title={title}
      className={cn(
        // A pill in the header's status band has to be able to give ground, and
        // the label truncating is not on its own enough to let it: `nowrap`
        // makes the pill's min-content its full label width, which is the
        // automatic minimum size a flex item refuses to shrink below, so the
        // band cannot narrow and the pill ends up cut off mid-word instead.
        //
        // An explicit min-width does both halves of the job. It overrides that
        // automatic minimum, so the pill shrinks and the label ellipsises; and
        // it stops the shrinking at the dot and the padding, so the pill never
        // closes over its own contents and draws its border through them. The
        // floor is per size, because the chrome is: 8px dot + 6px gap + the
        // horizontal padding + 2px of border.
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2 text-xs min-w-8' : 'h-7 px-2.5 text-sm min-w-9',
        c.text,
        c.bg,
        c.border,
        className
      )}
    >
      {dot}
      {/* Only when there is a label to show: an empty box would still take the
          flex gap and widen a pill that has nothing to say. `0` is a label. */}
      {children || children === 0 ? <span className="truncate">{children}</span> : null}
    </span>
  );
}
