import React from 'react';
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
export declare const STATUS_CLASS: Record<Status, {
    text: string;
    dot: string;
    bg: string;
    border: string;
}>;
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
export declare function StatusPill({ status, children, pulse, compact, size, className, title }: StatusPillProps): React.JSX.Element;
