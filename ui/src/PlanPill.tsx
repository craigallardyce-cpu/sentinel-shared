import { Button } from './Button';
import { cn } from './cn';
import { StatusPill } from './StatusPill';
import type { Status } from './StatusPill';

/**
 * The plan a customer is on, in the header, next to the other status pills.
 *
 * It is presentational on purpose: the apps display plan state and route the
 * customer to the website to change it, so this component takes plain props and
 * knows nothing about entitlements, Supabase or the subscription catalog. That
 * also keeps `@sentinel/ui` free of runtime dependencies — a new import here
 * would have to be aliased in three Vite configs before any app could build.
 *
 * Apps place it in `AppShell`'s existing `headerStatus` slot, beside their own
 * `StatusPill`s, which is why it is built from `StatusPill` itself rather than
 * from a second pill idiom.
 */

/** At or below this many whole days a trial takes the warning surface. */
const TRIAL_ENDING_DAYS = 3;

type PlanTone = 'paid' | 'trial' | 'trialEnding';

const TONE: Record<PlanTone, { status: Status; hover: string }> = {
  // A plan is not a health state, so it must not take green: `offline`'s muted
  // surface is the quietest thing in the fleet's status vocabulary, which is
  // what a healthy paid plan should be sitting next to an anchor alarm.
  paid: { status: 'offline', hover: 'group-hover:bg-bg-card-hover' },
  // `info` is the vocabulary's neutral informational tone — a running trial is
  // news, not a health state.
  trial: { status: 'info', hover: 'group-hover:bg-cyan/20' },
  // Amber, the fleet's warning colour, for the last few days. Deliberately no
  // pulse: on a header someone is watching at night an ending trial must never
  // read like an alarm.
  trialEnding: { status: 'warning', hover: 'group-hover:bg-warning/20' },
};

/**
 * Whole days remaining, or null when the trial is open-ended or the caller does
 * not know yet. A negative count (a trial the caller has not noticed expiring)
 * is clamped to the last day rather than shown as a negative number.
 */
function wholeDaysLeft(daysLeft: number | null | undefined): number | null {
  if (daysLeft === null || daysLeft === undefined || !Number.isFinite(daysLeft)) return null;
  return Math.max(0, Math.floor(daysLeft));
}

/** "last day" / "1 day left" / "12 days left" — never "0 days left". */
function remainingPhrase(days: number): string {
  if (days === 0) return 'last day';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

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

export function PlanPill({ planLabel, trial = false, daysLeft = null, onManage, onConvert }: PlanPillProps) {
  // No plan data yet (an app has none until its first entitlement read). A pill
  // that flashes a placeholder is worse than one that appears a moment later.
  if (planLabel === null) return null;

  const days = trial ? wholeDaysLeft(daysLeft) : null;
  const tone: PlanTone = !trial ? 'paid' : days !== null && days <= TRIAL_ENDING_DAYS ? 'trialEnding' : 'trial';

  // The pill itself is short because the header band is the first thing to be
  // squeezed; the plan name travels in the accessible name and the tooltip.
  const label = trial ? (days === null ? 'Trial' : `Trial — ${remainingPhrase(days)}`) : planLabel;

  const manageName = trial
    ? `${planLabel} trial${days === null ? '' : `, ${remainingPhrase(days)}`}. Manage or cancel your plan.`
    : `${planLabel} plan. Manage or cancel your plan.`;
  const convertName = `Upgrade from your ${planLabel} trial to a paid plan.`;

  return (
    // `shrink-[3]` and `min-w-8`: in a squeezed header the plan is the thing to
    // give way first — a plan is not a health state, and its name is in the
    // accessible name and the tooltip either way, where "Connected" beside it
    // is not — but it should stop at the width of the pill it holds rather than
    // closing over it.
    <span className="inline-flex items-center gap-2 shrink-[3] min-w-8">
      <button
        type="button"
        onClick={onManage}
        title={manageName}
        aria-label={manageName}
        className={cn(
          // min-h-11 (44px) for the tap target, as HeaderButton does: the pill
          // is 24px tall but the header is 56px, so the target is free.
          // `min-w-8` rather than `min-w-0`: the button has to be able to
          // narrow with the band, but never past the pill it wraps, or the tap
          // target would end up smaller than the thing being tapped.
          'group flex items-center min-w-8 min-h-11 rounded-full cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60'
        )}
      >
        {/* `StatusPill` truncates its own label, so there is nothing to add here. */}
        <StatusPill status={TONE[tone].status} className={cn('transition-colors', TONE[tone].hover)}>
          {label}
        </StatusPill>
      </button>
      {trial && onConvert && (
        // The package's own ghost Button rather than a hand-styled one: it is
        // transparent at rest, so it reads like the Night/Settings controls
        // beside it, and `sm` keeps a 40px target for a thumb on a phone.
        <Button variant="ghost" size="sm" onClick={onConvert} title={convertName} aria-label={convertName} className="shrink-0">
          Upgrade
        </Button>
      )}
    </span>
  );
}
