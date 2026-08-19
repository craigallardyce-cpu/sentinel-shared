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
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
        c.text,
        c.bg,
        c.border,
        className
      )}
    >
      {dot}
      {children}
    </span>
  );
}
