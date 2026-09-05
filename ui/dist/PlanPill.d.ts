export interface PlanPillProps {
    /** e.g. "Premium Suite" or "HarborSentinel Premium". Null while not yet known — render nothing. */
    planLabel: string | null;
    /** True when the current grant is a trial rather than a paid plan. */
    trial?: boolean;
    /** Whole days remaining in the trial. Only meaningful when `trial`. Null when open-ended or unknown. */
    daysLeft?: number | null;
    /** Opens the website's Account Status page. Always available. */
    onManage: () => void;
    /** Opens the website's pricing page to convert. Only rendered when `trial`. */
    onConvert?: () => void;
}
export declare function PlanPill({ planLabel, trial, daysLeft, onManage, onConvert }: PlanPillProps): import("react").JSX.Element | null;
