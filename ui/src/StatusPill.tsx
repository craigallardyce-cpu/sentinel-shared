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

/**
 * Classes for each status, for callers drawing their own status surface.
 * StatusPill itself uses only `dot` and `text` now; `bg` and `border` are kept
 * for anything outside this package that still builds from them.
 */
export const STATUS_CLASS: Record<Status, { text: string; dot: string; bg: string; border: string }> = {
  ok: { text: 'text-green', dot: 'bg-green', bg: 'bg-green/10', border: 'border-green/30' },
  warning: { text: 'text-warning', dot: 'bg-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
  alarm: { text: 'text-red', dot: 'bg-red', bg: 'bg-red/10', border: 'border-red/40' },
  offline: { text: 'text-text-muted', dot: 'bg-text-muted', bg: 'bg-bg-card', border: 'border-border-color' },
  info: { text: 'text-cyan', dot: 'bg-cyan', bg: 'bg-cyan/10', border: 'border-cyan/30' },
};

/**
 * The word beside the dot. The dot carries the state; the word only names
 * what the state is about ("Instruments", "Cloud"), so for the ordinary states
 * it stays quiet. Warning and alarm colour the word as well, because those are
 * the two a watchkeeper has to act on.
 */
const WORD: Record<Status, string> = {
  ok: 'text-text-secondary',
  info: 'text-text-secondary',
  offline: 'text-text-muted',
  warning: 'text-warning',
  alarm: 'text-red',
};

export interface StatusPillProps {
  status: Status;
  children?: React.ReactNode;
  /**
   * Animate the dot. Honoured only for `alarm`: only alarms pulse
   * (fit-and-finish X5), so a pulse asked for on any other status — syncing,
   * listening, pending — draws a still dot.
   */
  pulse?: boolean;
  /** Dot only, no label — for tight HUD spots. Provide `title` for a tooltip. */
  compact?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

/**
 * A dot and a word (fit-and-finish X3, X5). No border and no fill: it was a
 * bordered pill inside `HeaderGroup`'s bordered box, and a status is not a
 * control. The name is kept so no caller has to change.
 */
export function StatusPill({ status, children, pulse = false, compact = false, size = 'sm', className, title }: StatusPillProps) {
  const c = STATUS_CLASS[status];
  const pulsing = pulse && status === 'alarm';
  const dot = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      {pulsing && <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', c.dot)} />}
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
        // it stops the shrinking at the dot and the padding, so the dot is never
        // clipped. The floor is per size, because the padding is.
        //
        // The rounded corner draws nothing at rest; it is there for a caller
        // that tints the background on hover (PlanPill), so the tint is a pill.
        'inline-flex items-center gap-2 rounded-full font-sans font-normal whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2 text-[13px] min-w-8' : 'h-7 px-2.5 text-[15px] min-w-9',
        WORD[status],
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
