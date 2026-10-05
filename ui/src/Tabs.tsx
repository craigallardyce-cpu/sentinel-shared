import React, { useLayoutEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  /** A quiet mono number after the label: items on the tab, not a badge. */
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  /** The selected tab's id. */
  value: string;
  onChange: (id: string) => void;
  /**
   * Adds a tab. When set, a single + button follows the strip; there is no
   * other way to add one, so there is never a second, differently placed Add.
   */
  onAdd?: () => void;
  /** Accessible name and tooltip for the + button. Default "New tab". */
  addLabel?: string;
  /** Accessible name for the tab list. */
  'aria-label'?: string;
  /**
   * Prefix for the tab and panel ids. When set, each tab gets
   * `id="{prefix}-tab-{id}"` and `aria-controls="{prefix}-panel-{id}"`, so the
   * caller's panels can be `id="{prefix}-panel-{id}"` with
   * `aria-labelledby="{prefix}-tab-{id}"`.
   */
  idPrefix?: string;
  /** Class for the strip (the element that carries the bottom hairline). */
  className?: string;
}

/**
 * Where a tab strip should rest so the selected tab is whole and no tab is cut
 * at the left edge. `starts` are the tabs' left offsets in strip coordinates,
 * in order; `left`/`right` the selected tab's edges; `width` the visible width;
 * `current` the present scrollLeft.
 *
 * If the selected tab is already whole in view and the view starts on a tab
 * boundary, nothing moves. Otherwise the answer is the smallest tab start from
 * which the selected tab fits: 0 whenever it fits from the first tab.
 */
export function tabStripScrollFor(starts: number[], left: number, right: number, width: number, current: number): number {
  const sorted = [...starts].sort((a, b) => a - b);
  const first = sorted.length ? sorted[0] : 0;
  const atStart = current <= first;
  const onBoundary = atStart || sorted.some((s) => Math.abs(s - current) < 1);
  if (onBoundary && left >= current && right <= current + width) return atStart ? 0 : current;
  for (const s of sorted) {
    if (s > left) break;
    if (right - s <= width) return s <= first ? 0 : s;
  }
  return left <= first ? 0 : left;
}

/**
 * The fleet tab strip (fit-and-finish V9): one way to draw tabs, and one way to
 * add one.
 *
 * Sentence case, Inter 15/600, 48px targets. The selected tab is marked by a
 * 2px accent stroke along its bottom edge, sitting on the strip's own hairline;
 * no boxes, no pills and no icons. A count is a quiet mono numeral beside the
 * label, not a badge.
 *
 * Keyboard: the strip is one tab stop. Left and Right move between tabs and
 * select as they go (they wrap); Home and End jump to the ends.
 */
export function Tabs({
  items,
  value,
  onChange,
  onAdd,
  addLabel = 'New tab',
  'aria-label': ariaLabel,
  idPrefix,
  className,
}: TabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tailRef = useRef<HTMLSpanElement | null>(null);

  /* Keep the selected tab inside the scroll window, and never show a sliver.

     A strip that outruns its container scrolls, and nothing put the selected
     tab back in view -- so it could sit half out of the left edge, showing the
     tail of its own label while reading as selected. The first fix scrolled
     just far enough to show the selected tab plus 8px, which fixed that and
     made a new one: on HarborSentinel's phone Settings, opening About scrolled
     the strip by an arbitrary amount and left "Display" as a single "y" at the
     left edge (catalogue re-shoot, 2026-10).

     So the strip only ever rests on a tab boundary. On mount and whenever the
     selection changes, scrollLeft is the start of the leftmost tab from which
     the selected one still fits whole -- 0 when it fits without scrolling, so
     the first tab starts at the left edge -- and `snap-x` keeps a hand scroll
     landing on a boundary as well. A tab wider than the strip starts at its
     own left edge.

     Measured with offsetLeft against the strip, which is `relative` for the
     purpose: offsets ignore transforms, so a dialog still scaling or sliding
     in when this runs measures the same as one at rest. getBoundingClientRect
     did not. A layout effect, so the first paint is already in place. The
     strip's own scrollLeft is set rather than calling scrollIntoView, which
     would also scroll the dialog or page behind it. */
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tab = tabRefs.current.get(value);
    if (!strip || !tab) return;
    const starts = items
      .map((t) => tabRefs.current.get(t.id))
      .filter((el): el is HTMLButtonElement => !!el)
      .map((el) => el.offsetLeft);
    const target = tabStripScrollFor(starts, tab.offsetLeft, tab.offsetLeft + tab.offsetWidth, strip.clientWidth, strip.scrollLeft);
    /* A boundary near the end can lie past the furthest the strip can scroll,
       and the browser would clamp it -- back to a sliver. The tail spacer
       after the strip's last item makes up the difference, so the target is
       reachable; it is empty space after the last tab, never under a label. */
    const tail = tailRef.current;
    if (tail) {
      tail.style.width = '0px';
      const max = strip.scrollWidth - strip.clientWidth;
      if (target > max) tail.style.width = `${Math.ceil(target - max)}px`;
    }
    strip.scrollLeft = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new `items` array each render must not pull a hand-scrolled strip back
  }, [value, items.length]);

  const selectedIndex = Math.max(
    0,
    items.findIndex((t) => t.id === value)
  );
  // The one tab stop: the selected tab, or the first when nothing matches.
  const focusId = items.some((t) => t.id === value) ? value : items[0]?.id;

  const moveTo = (index: number) => {
    const n = items.length;
    if (n === 0) return;
    const next = items[((index % n) + n) % n];
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        moveTo(selectedIndex + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(selectedIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(items.length - 1);
        break;
    }
  };

  return (
    <div
      ref={stripRef}
      className={cn('relative flex items-end gap-1 overflow-x-auto snap-x border-b border-bg-highest select-none', className)}
    >
      <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" className="flex items-end gap-1">
        {items.map((t) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
                else tabRefs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
              aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
              aria-selected={selected}
              tabIndex={t.id === focusId ? 0 : -1}
              data-tab-id={t.id}
              onClick={() => onChange(t.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'inline-flex items-center gap-2 h-12 px-4 -mb-px border-b-2 whitespace-nowrap cursor-pointer snap-start shrink-0',
                'font-sans text-[15px] font-semibold',
                'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan/60 rounded-t-md',
                selected
                  ? 'border-cyan text-cyan'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="font-mono font-medium text-[13px] text-text-muted tabular-nums" data-slot="count">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className={cn(
            'inline-flex items-center justify-center h-12 w-12 shrink-0 rounded-md cursor-pointer',
            'text-text-muted hover:text-text-primary hover:bg-bg-card-hover',
            'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60'
          )}
        >
          <Plus size={20} aria-hidden />
        </button>
      )}
      <span ref={tailRef} aria-hidden className="block shrink-0 self-stretch" style={{ width: 0 }} data-slot="tabs-tail" />
    </div>
  );
}
