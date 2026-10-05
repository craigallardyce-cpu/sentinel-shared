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
/**
 * Set by AppShell around its header status band. Inside it, below `sm`, a
 * StatusPill draws its dot alone and keeps its word for screen readers.
 *
 * The band yields width to the controls beside it, and a word squeezed there
 * was cut mid-word: OceanSentinel's phone header read "Instrum…", which says
 * less than the dot does on its own. A status word is never truncated in the
 * header now; at phone width it is not drawn. HarborSentinel already passed a
 * `compact` pill below `sm` for the same reason; that still works, and every
 * other caller gets the same behaviour without having to know to ask.
 */
export declare const HeaderStatusContext: React.Context<boolean>;
export interface StatusPillProps {
    status: Status;
    children?: React.ReactNode;
    /**
     * Animate the dot. Honoured for `alarm` only (fit-and-finish X5): an alarm is
     * the one state that needs a hand, and a pulse anywhere else teaches the eye
     * to ignore it. Ignored for `ok`, `info`, `offline` and `warning`, so
     * "syncing", "acquiring" and "due soon" draw a still dot.
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
