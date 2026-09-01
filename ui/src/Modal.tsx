import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** One line under the title. */
  description?: React.ReactNode;
  /** Icon drawn before the title (e.g. `<Settings size={18} />`). */
  icon?: React.ReactNode;
  size?: ModalSize;
  /** Footer content — usually `<Button>`s. Laid out right-aligned. */
  footer?: React.ReactNode;
  /** Close when the scrim is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close on Escape. Default true. */
  closeOnEscape?: boolean;
  /** Hide the × button. */
  hideClose?: boolean;
  /** Class for the scrollable body. */
  bodyClassName?: string;
  /** Class for the panel. */
  className?: string;
  /** Draws the panel with the alarm treatment (red border + glow). */
  tone?: 'default' | 'danger';
  children?: React.ReactNode;
}

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** z-index of the modal layer. Toasts sit above it (see Toast.tsx). */
export const MODAL_Z = 1100;

/**
 * The fleet dialog: one scrim, one radius, one motion, focus trapped, Escape
 * closes. Use it for every overlay that blocks the page — settings, editors,
 * confirmations — instead of a hand-rolled fixed div.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  size = 'md',
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideClose = false,
  bodyClassName,
  className,
  tone = 'default',
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Focus management: remember the opener, focus the panel, restore on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    // Defer so the portal has painted.
    const t = setTimeout(() => first?.focus({ preventScroll: true }), 0);
    return () => {
      clearTimeout(t);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Escape + Tab trapping.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, closeOnEscape, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-bg-lowest/80 backdrop-blur-sm animate-[sentinel-fade_150ms_ease-out]"
      style={{
        zIndex: MODAL_Z,
        paddingTop: 'calc(1rem + var(--safe-area-top, 0px))',
        paddingBottom: 'calc(1rem + var(--safe-area-bottom, 0px))',
        paddingLeft: 'calc(1rem + var(--safe-area-left, 0px))',
        paddingRight: 'calc(1rem + var(--safe-area-right, 0px))',
      }}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'w-full flex flex-col max-h-full rounded-xl border shadow-[0_8px_32px_rgba(0,0,0,0.5)] outline-none',
          'bg-bg-panel text-text-primary animate-[sentinel-rise_200ms_cubic-bezier(0.16,1,0.3,1)]',
          tone === 'danger' ? 'border-red/50 shadow-[0_0_24px_var(--color-red-glow)]' : 'border-border-color',
          SIZE[size],
          className
        )}
      >
        {(title || !hideClose) && (
          <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border-color/60">
            {icon && <span className={cn('mt-0.5 shrink-0', tone === 'danger' ? 'text-red' : 'text-cyan')}>{icon}</span>}
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="font-heading font-semibold text-base leading-tight text-text-primary">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="text-xs text-text-muted mt-1">
                  {description}
                </p>
              )}
            </div>
            {!hideClose && (
              <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} className="-mr-2 -mt-1 w-10 px-0">
                <X size={16} />
              </Button>
            )}
          </header>
        )}
        <div className={cn('flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4', bodyClassName)}>{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-border-color/60">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` draws the confirm button and panel in the alarm colour. */
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  /** Shows a spinner on the confirm button. */
  busy?: boolean;
}

/** A yes/no question. For one-off use from code, prefer `confirm()` from Toast.tsx. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      tone={tone}
      hideClose
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-text-secondary leading-relaxed">{message}</p>}
    </Modal>
  );
}
