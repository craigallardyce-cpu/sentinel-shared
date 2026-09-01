import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';
const SIZE = {
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
export function Modal({ open, onClose, title, description, icon, size = 'md', footer, closeOnBackdrop = true, closeOnEscape = true, hideClose = false, bodyClassName, className, tone = 'default', children, }) {
    const panelRef = useRef(null);
    const titleId = useId();
    const descId = useId();
    // Focus management: remember the opener, focus the panel, restore on close.
    useEffect(() => {
        if (!open)
            return;
        const previouslyFocused = document.activeElement;
        const panel = panelRef.current;
        const first = panel?.querySelector('[data-autofocus]') ?? panel?.querySelector(FOCUSABLE) ?? panel;
        // Defer so the portal has painted.
        const t = setTimeout(() => first?.focus({ preventScroll: true }), 0);
        return () => {
            clearTimeout(t);
            previouslyFocused?.focus?.({ preventScroll: true });
        };
    }, [open]);
    // Escape + Tab trapping.
    useEffect(() => {
        if (!open)
            return;
        const onKey = (e) => {
            if (e.key === 'Escape' && closeOnEscape) {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key !== 'Tab' || !panelRef.current)
                return;
            const nodes = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null);
            if (nodes.length === 0) {
                e.preventDefault();
                return;
            }
            const firstNode = nodes[0];
            const lastNode = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === firstNode) {
                e.preventDefault();
                lastNode.focus();
            }
            else if (!e.shiftKey && document.activeElement === lastNode) {
                e.preventDefault();
                firstNode.focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [open, closeOnEscape, onClose]);
    // Lock background scroll while open.
    useEffect(() => {
        if (!open)
            return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);
    if (!open || typeof document === 'undefined')
        return null;
    return createPortal(_jsx("div", { className: "fixed inset-0 flex items-center justify-center bg-bg-lowest/80 backdrop-blur-sm animate-[sentinel-fade_150ms_ease-out]", style: {
            zIndex: MODAL_Z,
            paddingTop: 'calc(1rem + var(--safe-area-top, 0px))',
            paddingBottom: 'calc(1rem + var(--safe-area-bottom, 0px))',
            paddingLeft: 'calc(1rem + var(--safe-area-left, 0px))',
            paddingRight: 'calc(1rem + var(--safe-area-right, 0px))',
        }, onMouseDown: (e) => {
            if (closeOnBackdrop && e.target === e.currentTarget)
                onClose();
        }, children: _jsxs("div", { ref: panelRef, role: "dialog", "aria-modal": "true", "aria-labelledby": title ? titleId : undefined, "aria-describedby": description ? descId : undefined, tabIndex: -1, className: cn('w-full flex flex-col max-h-full rounded-xl border shadow-[0_8px_32px_rgba(0,0,0,0.5)] outline-none', 'bg-bg-panel text-text-primary animate-[sentinel-rise_200ms_cubic-bezier(0.16,1,0.3,1)]', tone === 'danger' ? 'border-red/50 shadow-[0_0_24px_var(--color-red-glow)]' : 'border-border-color', SIZE[size], className), children: [(title || !hideClose) && (_jsxs("header", { className: "flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border-color/60", children: [icon && _jsx("span", { className: cn('mt-0.5 shrink-0', tone === 'danger' ? 'text-red' : 'text-cyan'), children: icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [title && (_jsx("h2", { id: titleId, className: "font-heading font-semibold text-base leading-tight text-text-primary", children: title })), description && (_jsx("p", { id: descId, className: "text-xs text-text-muted mt-1", children: description }))] }), !hideClose && (_jsx(Button, { variant: "ghost", size: "sm", "aria-label": "Close", onClick: onClose, className: "-mr-2 -mt-1 w-10 px-0", children: _jsx(X, { size: 16 }) }))] })), _jsx("div", { className: cn('flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4', bodyClassName), children: children }), footer && _jsx("footer", { className: "flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-border-color/60", children: footer })] }) }), document.body);
}
/** A yes/no question. For one-off use from code, prefer `confirm()` from Toast.tsx. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default', onConfirm, onCancel, busy = false, }) {
    return (_jsx(Modal, { open: open, onClose: onCancel, title: title, size: "sm", tone: tone, hideClose: true, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: onCancel, disabled: busy, children: cancelLabel }), _jsx(Button, { variant: tone === 'danger' ? 'danger' : 'primary', onClick: onConfirm, loading: busy, "data-autofocus": true, children: confirmLabel })] }), children: message && _jsx("p", { className: "text-sm text-text-secondary leading-relaxed", children: message }) }));
}
