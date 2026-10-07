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
    /**
     * Offer a control to collapse the banner to a compact pill (see "Collapsing"
     * below). Off by default. Implied by `collapseStore`; on its own the collapse
     * lasts until the component unmounts.
     */
    collapsible?: boolean;
    /**
     * Where the collapse is remembered between launches. The banner never
     * touches storage itself; `localStorageCollapseStore(key)` is the usual one.
     * Passing a store turns collapsing on.
     */
    collapseStore?: AdvisoryCollapseStore | null;
    /**
     * Layout classes. With collapsing on they go on the wrapper that holds the
     * banner and its collapse button (or the pill), so the host places one box.
     */
    className?: string;
}
/**
 * What a collapse remembers: the identities (`advisoryKey`) of the advisories
 * that were in force when it was made.
 */
export type AdvisoryCollapseSnapshot = readonly string[];
/**
 * The host's storage for the collapse. `read` returns null when nothing is
 * stored; `write(null)` forgets it. Either may throw: the banner treats a
 * throwing read as "not collapsed" and a throwing write as a collapse that
 * lasts for this session only.
 */
export interface AdvisoryCollapseStore {
    read(): AdvisoryCollapseSnapshot | null;
    write(snapshot: AdvisoryCollapseSnapshot | null): void;
}
/**
 * One advisory's identity: its event name and when it took effect. NWS alerts
 * reach the apps without an id, so this is the nearest stable thing, and an
 * advisory re-issued with a new start time counts as new, which errs towards
 * showing it.
 */
export declare function advisoryKey(a: Pick<BannerWarning, 'event' | 'effective'>): string;
/**
 * The safety rule. Collapsed only when something was collapsed, something is
 * in force, and every advisory in force was among those collapsed. A new one
 * -- a different event, or the same event with a new `effective` -- shows the
 * banner expanded again.
 */
export declare function isAdvisoryCollapsed(collapsed: AdvisoryCollapseSnapshot | null | undefined, inForce: readonly string[]): boolean;
/** Whether `inForce` holds an advisory the snapshot does not, i.e. the stored collapse is spent. */
export declare function hasNewAdvisory(collapsed: AdvisoryCollapseSnapshot | null | undefined, inForce: readonly string[]): boolean;
/** A stored snapshot, or null when there is none or it is not one (junk is dropped, never thrown). */
export declare function parseAdvisoryCollapse(raw: string | null | undefined): string[] | null;
/** The subset of `Storage` the default store uses, so tests can pass their own. */
export interface CollapseStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
/**
 * A store kept in this device's `localStorage` under `key`, as a JSON array of
 * `advisoryKey`s (the format HarborSentinel #100 wrote to
 * `harbor_advisory_collapsed`). Every access is guarded: storage that is
 * absent, throws, or holds junk reads as "not collapsed", and a failed write
 * is dropped. `storage` is for tests; it defaults to `window.localStorage`.
 */
export declare function localStorageCollapseStore(key: string, storage?: CollapseStorageLike | null): AdvisoryCollapseStore;
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
/**
 * The banner. Without `collapsible` or `collapseStore` it is exactly the banner
 * it always was; with either, see `CollapsibleWarningsBanner` below.
 */
export declare function WarningsBanner(props: WarningsBannerProps): React.JSX.Element;
export default WarningsBanner;
