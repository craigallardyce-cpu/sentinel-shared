import React from 'react';
/** The fields the banner reads. `WeatherAlert` from this package satisfies it. */
export interface BannerWarning {
    /** NWS event name, e.g. "Gale Warning". Shown in sentence case. */
    event: string;
    headline?: string | null;
    description?: string | null;
    instruction?: string | null;
    /** NWS CAP severity: Extreme, Severe, Moderate, Minor or Unknown. */
    severity?: string | null;
    /** ISO time the warning takes effect. */
    effective?: string | null;
    /** ISO time it ends (the apps fall back to `expires`). */
    ends?: string | null;
    /** Issuing office. Absent on advisories an app synthesised from forecast wording. */
    senderName?: string | null;
    /** Host override of the colour. Omitted, it is derived; see `warningLevel`. */
    level?: WarningLevel;
}
export type WarningLevel = 'alarm' | 'warning';
/**
 * The ways of having nothing to show that are not an all-clear.
 *
 *   no-coverage  no warning service covers this position (NWS stops at the US
 *                border), so nobody was asked
 *   no-position  no position, so nobody was asked
 *   not-checked  the check ran and did not get an answer
 *
 * The host decides which one applies (the two apps rank them differently) and
 * passes `null` or nothing for a genuine all-clear, which renders nothing.
 */
export type WarningsNotice = 'no-coverage' | 'no-position' | 'not-checked';
export interface WarningsBannerProps {
    /** Warnings in force. Empty and no `notice`: the banner renders nothing. */
    warnings: readonly BannerWarning[] | null | undefined;
    /** A non-answer to state quietly when there are no warnings. Ignored while any warning shows. */
    notice?: WarningsNotice | null;
    /** Place the warnings are for (location or marine zone). Shown in the expanded list only. */
    area?: string | null;
    /** The warnings are for the chart centre rather than the boat (HarborSentinel, no fix). */
    usingChartCentre?: boolean;
    /** A short clause read with the top warning, e.g. OceanSentinel's forecast hazard statement. */
    detail?: string | null;
    /**
     * The check behind `warnings` failed and these are from the last good one.
     * The banner says so with their age (from `checkedAt`) rather than showing them as current.
     */
    stale?: boolean;
    /** When the last successful check was, in ms. Read only when `stale`. */
    checkedAt?: number | null;
    /** These may not be every warning in force (read from forecast wording after the alerts check failed). */
    partial?: boolean;
    /**
     * Replace the inline expand with the host's own detail view (a modal, a tab).
     * With it, the banner is a single button that calls this, and the notice
     * becomes one too.
     */
    onOpen?: () => void;
    /** Offer "Open the full forecast" at the foot of the expanded list. */
    onOpenForecast?: () => void;
    /** Start expanded. */
    defaultExpanded?: boolean;
    /** Clock for "last checked" ages; tests pass one. */
    now?: number;
    className?: string;
}
/**
 * Alarm (red) or warning (amber) for one warning.
 *
 * Alarm when NWS rates it Severe or Extreme, when its name says it is a
 * Warning (the NWS word for a hazard occurring or imminent, whatever severity
 * the feed attached), or when there is no usable severity at all: both apps
 * showed every alert red until now, and a warning the feed failed to grade is
 * not a reason to play it down. Warning (amber) is reserved for what is
 * graded Moderate or Minor and is not named a Warning: advisories, watches,
 * statements. That is the split both apps' weather services already use for
 * their risk level (Severe/Extreme high, Moderate moderate).
 */
export declare function warningLevel(w: BannerWarning): WarningLevel;
/** Most severe first: alarm before warning, then NWS severity, then the host's order. */
export declare function sortWarnings<T extends BannerWarning>(warnings: readonly T[]): T[];
/**
 * "Gale Warning" -> "Gale warning". NWS event names arrive in title case; the
 * fleet writes sentence case. Words already in capitals (an acronym) keep them.
 */
export declare function sentenceCase(text: string): string;
/** "just now", "12 min ago", "3 h ago", "2 days ago". Same wording as OceanSentinel's strip. */
export declare function formatCheckAge(checkedAt: number | null | undefined, now?: number): string | null;
export declare function WarningsBanner({ warnings, notice, area, usingChartCentre, detail, stale, checkedAt, partial, onOpen, onOpenForecast, defaultExpanded, now, className, }: WarningsBannerProps): React.JSX.Element | null;
export default WarningsBanner;
