import React, { useEffect } from 'react';
import { cn } from './cn';

/**
 * The small pop-over menu the fleet hangs off a button: VesselKeeper's row
 * actions, View menu and Maintenance tab options, OceanSentinel's Ship's Log ⋮
 * menu and its VHF conversation menu. Moved here from VesselKeeper
 * (`src/client/components/Menu.tsx`, fit-and-finish V6, V7, V9) so the three
 * apps draw one menu and close it one way.
 *
 * One look -- a floating surface (radius 16, the one panel shadow), 48px rows
 * in sentence case -- and one way to close: a press outside, or Escape. Inside
 * the panel the arrow keys, Home and End move between the items.
 *
 * Usage: a `relative` wrapper holding the trigger and the panel, with
 * `useDismiss(wrapperRef, open, close)` on the wrapper, so a press on the
 * trigger itself is not "outside".
 */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, open, onClose]);
}

const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** Arrow keys, Home and End between the enabled items of a menu. */
function moveFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (!MOVE_KEYS.has(e.key)) return;
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
  );
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : e.key === 'ArrowDown' ? (at + 1) % items.length
    : at <= 0 ? items.length - 1 : at - 1;
  items[next].focus();
}

export interface MenuPanelProps {
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end';
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /** Accessible name for the menu. */
  label?: string;
}

export function MenuPanel({ align = 'end', className, style, children, label }: MenuPanelProps) {
  return (
    <div
      role="menu"
      aria-label={label}
      style={style}
      onKeyDown={moveFocus}
      className={cn(
        'absolute top-full mt-1 z-30 min-w-[14rem] py-1 bg-bg-panel border border-border-color rounded-xl shadow-[var(--panel-shadow)]',
        align === 'end' ? 'right-0' : 'left-0',
        className
      )}
    >
      {children}
    </div>
  );
}

export interface MenuItemProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  icon?: React.ReactNode;
  /** `danger` for a destructive item; the colour states the consequence. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  children: React.ReactNode;
  /** A second, quieter line under the label. */
  hint?: React.ReactNode;
}

export function MenuItem({ onClick, icon, tone = 'default', disabled, children, hint }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full min-h-12 px-4 py-2 flex items-center gap-3 text-left cursor-pointer',
        'text-body-md font-semibold',
        'hover:bg-bg-card-hover focus-visible:outline-none focus-visible:bg-bg-card-hover',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]',
        tone === 'danger' ? 'text-red' : 'text-text-primary'
      )}
    >
      {icon && <span className="shrink-0 text-text-secondary [&>svg]:w-5 [&>svg]:h-5" aria-hidden>{icon}</span>}
      <span className="min-w-0">
        <span className="block">{children}</span>
        {hint && <span className="block text-body-sm text-text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className="my-1 border-t border-bg-highest" />;
}
