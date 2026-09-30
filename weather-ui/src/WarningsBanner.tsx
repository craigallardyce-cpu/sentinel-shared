import React, { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CloudOff, TriangleAlert } from 'lucide-react';

/*
  The marine-warnings banner: one component for HarborSentinel and OceanSentinel.
  ---------------------------------------------------------------------------
  Both apps drew their own strip across the top of the chart, and both said
  "No active warnings" when nothing was wrong (fit-and-finish H4, O2, X4). That
  restated the header's SAFE state and took the top centre of the chart on every
  calm day. So the rule here is the whole point of the component:

    **No warnings in force renders nothing at all.**

  Having *no warnings to show* is not the same as there being no warnings, and
  both apps learned that the hard way: outside NWS coverage, with no position,
  or when the check failed, the list is just as empty. Those are not an
  all-clear, and rendering nothing for them would make them look exactly like
  one. They stay, as a quiet one-line `notice` the host has to ask for
  explicitly. The banner never infers one from an empty list.

  Styling is tokens only (`@sentinel/theme`), so night mode follows with no code
  here: a solid panel with no backdrop blur, the 16px surface radius, the one
  panel shadow, and severity carried by stroke and fill in `--color-red` /
  `--color-warning` and their `-dim` pairs. Nothing glows.
*/

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

/* ------------------------------------------------------------------------ */
/* Pure helpers, exported for the apps' own tests and for reuse.             */
/* ------------------------------------------------------------------------ */

const SEVERITY_RANK: Record<string, number> = { extreme: 4, severe: 3, moderate: 2, minor: 1 };

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
export function warningLevel(w: BannerWarning): WarningLevel {
  if (w.level) return w.level;
  const sev = (w.severity || '').toLowerCase();
  if (sev === 'extreme' || sev === 'severe') return 'alarm';
  if (/\bwarning\b/i.test(w.event || '')) return 'alarm';
  if (sev === 'moderate' || sev === 'minor') return 'warning';
  return 'alarm';
}

/** Most severe first: alarm before warning, then NWS severity, then the host's order. */
export function sortWarnings<T extends BannerWarning>(warnings: readonly T[]): T[] {
  return warnings
    .map((w, i) => ({ w, i }))
    .sort((a, b) => {
      const la = warningLevel(a.w) === 'alarm' ? 1 : 0;
      const lb = warningLevel(b.w) === 'alarm' ? 1 : 0;
      if (la !== lb) return lb - la;
      const sa = SEVERITY_RANK[(a.w.severity || '').toLowerCase()] ?? 0;
      const sb = SEVERITY_RANK[(b.w.severity || '').toLowerCase()] ?? 0;
      if (sa !== sb) return sb - sa;
      return a.i - b.i;
    })
    .map(({ w }) => w);
}

/**
 * "Gale Warning" -> "Gale warning". NWS event names arrive in title case; the
 * fleet writes sentence case. Words already in capitals (an acronym) keep them.
 */
export function sentenceCase(text: string): string {
  const words = (text || '').trim().split(/\s+/);
  return words
    .map((word, i) => {
      if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". Same wording as OceanSentinel's strip. */
export function formatCheckAge(checkedAt: number | null | undefined, now: number = Date.now()): string | null {
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return null;
  const mins = Math.max(0, Math.floor((now - checkedAt) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function formatWhen(iso: string | null | undefined, withDate: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, withDate
    ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

const NOTICE_TEXT: Record<WarningsNotice, string> = {
  'no-coverage': 'No warning service covers this position — not an all-clear',
  'no-position': 'No position, so no warnings checked — not an all-clear',
  'not-checked': "Couldn't check for warnings — not an all-clear",
};

/* Token classes. Every colour and radius resolves through @sentinel/theme, so
   `.theme-night` re-colours all of it. Both consuming apps already @source this
   package's dist for Tailwind. */
const TONE: Record<WarningLevel, { band: string; text: string; chip: string }> = {
  alarm: {
    band: 'border-red',
    text: 'text-red',
    chip: 'bg-red-dim border-red text-text-primary',
  },
  warning: {
    band: 'border-warning',
    text: 'text-warning',
    chip: 'bg-warning-dim border-warning text-text-primary',
  },
};

const SURFACE = 'bg-bg-panel rounded-xl shadow-[var(--panel-shadow)] border font-sans';

/* ------------------------------------------------------------------------ */

export function WarningsBanner({
  warnings,
  notice = null,
  area,
  usingChartCentre = false,
  detail,
  stale = false,
  checkedAt = null,
  partial = false,
  onOpen,
  onOpenForecast,
  defaultExpanded = false,
  now,
  className = '',
}: WarningsBannerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const listId = useId();

  const sorted = useMemo(() => sortWarnings((warnings || []).filter(Boolean)), [warnings]);

  if (sorted.length === 0) {
    if (!notice) return null;
    return <NoticeRow notice={notice} usingChartCentre={usingChartCentre} onOpen={onOpen} className={className} />;
  }

  const top = sorted[0];
  const level = warningLevel(top);
  const tone = TONE[level];
  const more = sorted.length - 1;
  const age = stale ? formatCheckAge(checkedAt, now) : null;
  const until = formatWhen(top.ends, false);

  /* The one clause read after the event name, most useful first: the host's
     own statement, else when the top warning ends. */
  const secondary = detail ? (
    <span className="truncate min-w-0">{detail}</span>
  ) : until ? (
    <span className="truncate min-w-0">
      until <span className="font-mono">{until}</span>
    </span>
  ) : null;

  const summary = (
    <>
      <TriangleAlert size={20} strokeWidth={1.75} aria-hidden className={`shrink-0 ${tone.text}`} />
      <span className={`font-semibold shrink-0 max-w-[60%] truncate ${tone.text}`}>{sentenceCase(top.event)}</span>
      {more > 0 && (
        <span
          data-testid="warnings-banner-count"
          className={`shrink-0 inline-flex items-center rounded-full border px-2 text-body-sm font-semibold ${tone.chip}`}
        >
          <span className="font-mono">+{more}</span>&nbsp;more
        </span>
      )}
      <span className="flex-1 min-w-0 flex items-center gap-2 text-text-secondary">
        {secondary}
        {age && (
          <span className="shrink-0 text-body-sm text-text-muted">
            last checked <span className="font-mono">{age}</span>
          </span>
        )}
        {usingChartCentre && <span className="shrink-0 text-body-sm text-text-muted">Chart centre</span>}
      </span>
    </>
  );

  const rowClass =
    'w-full min-h-12 flex items-center gap-3 pl-4 pr-2 text-left text-body-md cursor-pointer ' +
    'rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

  return (
    <section
      aria-label="Marine warnings"
      role={level === 'alarm' ? 'alert' : 'status'}
      className={`pointer-events-auto ${SURFACE} ${tone.band} ${className}`}
    >
      {onOpen ? (
        <button type="button" className={rowClass} onClick={onOpen}>
          {summary}
          <ChevronRight size={20} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-muted" />
        </button>
      ) : (
        <button
          type="button"
          className={rowClass}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {summary}
          <ChevronDown
            size={20}
            strokeWidth={1.75}
            aria-hidden
            className={`shrink-0 text-text-muted transition-transform duration-[var(--motion-state)] ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      {!onOpen && expanded && (
        <div id={listId} className="px-4 pb-4 pt-1 flex flex-col gap-3 text-body-md text-text-primary">
          {(area || stale || partial) && (
            <div className="flex flex-col gap-1 text-body-sm text-text-secondary">
              {area && <span>{area}</span>}
              {stale && (
                <span>
                  {"Couldn't check for warnings — these are from the last check"}
                  {age && (
                    <>
                      , <span className="font-mono">{age}</span>
                    </>
                  )}
                  . Others may have been issued since.
                </span>
              )}
              {partial && (
                <span>These may not be all the warnings in force: the warnings check failed, so these are read from the forecast.</span>
              )}
            </div>
          )}
          <ul className="flex flex-col gap-3" aria-label="Warnings in force">
            {sorted.map((w, i) => (
              <WarningItem key={`${w.event}-${i}`} warning={w} />
            ))}
          </ul>
          {onOpenForecast && (
            <button
              type="button"
              onClick={onOpenForecast}
              className="self-start min-h-12 text-body-md font-semibold text-cyan cursor-pointer hover:underline"
            >
              Open the full forecast
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function WarningItem({ warning }: { warning: BannerWarning }) {
  const tone = TONE[warningLevel(warning)];
  const from = formatWhen(warning.effective, true);
  const to = formatWhen(warning.ends, true);
  return (
    <li className={`rounded-md border-l-4 ${tone.band} bg-bg-card px-3 py-2 flex flex-col gap-1`}>
      <span className={`font-semibold ${tone.text}`}>{sentenceCase(warning.event)}</span>
      {warning.headline && <span className="text-body-md text-text-primary">{warning.headline}</span>}
      {(from || to) && (
        <span className="text-body-sm font-mono text-text-muted">
          {from ?? '—'} → {to ?? 'until further notice'}
        </span>
      )}
      {warning.instruction && (
        <span className="text-body-sm text-text-secondary whitespace-pre-wrap">{warning.instruction}</span>
      )}
      {warning.senderName && <span className="text-body-sm text-text-muted">Issued by {warning.senderName}</span>}
    </li>
  );
}

function NoticeRow({
  notice,
  usingChartCentre,
  onOpen,
  className,
}: {
  notice: WarningsNotice;
  usingChartCentre: boolean;
  onOpen?: () => void;
  className: string;
}) {
  /* Quiet on purpose: a neutral hairline and secondary text, not a status
     colour. Outside NWS coverage this shows every day, and an amber band across
     the chart for a permanent condition is the H4 problem again. It must only
     never look like an all-clear, and it does not: it says so in words. */
  const body = (
    <>
      <CloudOff size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-muted" />
      <span className="text-balance">{NOTICE_TEXT[notice]}</span>
      {usingChartCentre && <span className="shrink-0 text-text-muted">· Chart centre</span>}
    </>
  );
  const shape =
    'pointer-events-auto inline-flex w-fit max-w-full items-center gap-2 px-4 py-1.5 min-h-9 ' +
    'bg-bg-panel border border-border-color rounded-full shadow-[var(--panel-shadow)] ' +
    'font-sans text-body-sm text-text-secondary';
  return onOpen ? (
    <button
      type="button"
      data-notice={notice}
      onClick={onOpen}
      className={`${shape} text-left cursor-pointer ${className}`}
    >
      {body}
    </button>
  ) : (
    <div role="status" data-notice={notice} className={`${shape} ${className}`}>
      {body}
    </div>
  );
}

export default WarningsBanner;
