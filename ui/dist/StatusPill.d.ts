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
/**
 * Classes for each status, for callers drawing their own status surface.
 * StatusPill itself uses only `dot` and `text` now; `bg` and `border` are kept
 * for anything outside this package that still builds from them.
 */
export declare const STATUS_CLASS: Record<Status, {
    text: string;
    dot: string;
    bg: string;
    border: string;
}>;
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
export declare function StatusPill({ status, children, pulse, compact, size, className, title }: StatusPillProps): React.JSX.Element;
