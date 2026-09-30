import React, { useEffect, useRef } from 'react';
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

  /* Keep the selected tab inside the scroll window.

     A strip that outruns its container scrolls, and nothing puts the selected
     tab back in view -- so it can sit half out of the left edge, showing the
     tail of its own label while reading as selected. Adjusting this element's
     own scrollLeft rather than calling scrollIntoView, which would also scroll
     the dialog or page behind it. Measured with getBoundingClientRect rather
     than offsetLeft, which is relative to the nearest positioned ancestor. */
  useEffect(() => {
    const strip = stripRef.current;
    const tab = tabRefs.current.get(value);
    if (!strip || !tab) return;
    const t = tab.getBoundingClientRect();
    const r = strip.getBoundingClientRect();
    const pad = 8;
    if (t.left < r.left + pad) strip.scrollLeft -= r.left + pad - t.left;
    else if (t.right > r.right - pad) strip.scrollLeft += t.right - (r.right - pad);
  }, [value]);

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
      className={cn('flex items-end gap-1 overflow-x-auto border-b border-bg-highest select-none', className)}
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
                'inline-flex items-center gap-2 h-12 px-4 -mb-px border-b-2 whitespace-nowrap cursor-pointer',
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
    </div>
  );
}
