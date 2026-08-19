import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import { cn } from './cn';
import { ConfirmDialog } from './Modal';
import { MODAL_Z } from './Modal';
const listeners = new Set();
let toasts = [];
let pendingConfirm = null;
let seq = 0;
const MAX_VISIBLE = 4;
function emit() {
    listeners.forEach((l) => l());
}
function subscribe(l) {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
}
function getToasts() {
    return toasts;
}
function getConfirm() {
    return pendingConfirm;
}
function push(kind, message, opts = {}) {
    const id = opts.id ?? `t${++seq}`;
    const item = {
        id,
        kind,
        message,
        detail: opts.detail,
        action: opts.action,
        duration: opts.duration ?? (kind === 'error' ? 7000 : 4500),
    };
    const existing = toasts.findIndex((t) => t.id === id);
    if (existing >= 0)
        toasts = toasts.map((t, i) => (i === existing ? item : t));
    else
        toasts = [...toasts, item].slice(-MAX_VISIBLE);
    emit();
    return id;
}
function dismiss(id) {
    if (!toasts.some((t) => t.id === id))
        return;
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}
/**
 * Imperative toast API. Works anywhere once a <ToastProvider> is mounted.
 *
 *   toast.success('Route exported');
 *   toast.error('Could not read the GPX file', { detail: err.message });
 */
export const toast = {
    info: (message, opts) => push('info', message, opts),
    success: (message, opts) => push('success', message, opts),
    warning: (message, opts) => push('warning', message, opts),
    error: (message, opts) => push('error', message, opts),
    dismiss,
    clear: () => {
        toasts = [];
        emit();
    },
};
/**
 * Promise-based replacement for `window.confirm`. Resolves true/false.
 *
 *   if (await confirm({ title: 'Delete this voyage?', message: '…', tone: 'danger', confirmLabel: 'Delete' })) { … }
 *
 * Only one confirm can be open at a time; a second call while one is pending
 * resolves false immediately.
 */
export function confirm(opts) {
    if (pendingConfirm)
        return Promise.resolve(false);
    return new Promise((resolve) => {
        pendingConfirm = {
            ...opts,
            resolve: (ok) => {
                pendingConfirm = null;
                emit();
                resolve(ok);
            },
        };
        emit();
    });
}
/** Hook form of the same API, for components that prefer not to import singletons. */
export function useToast() {
    return toast;
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const KIND = {
    info: { icon: _jsx(Info, { size: 18 }), ring: 'border-cyan/40', fg: 'text-cyan' },
    success: { icon: _jsx(CheckCircle2, { size: 18 }), ring: 'border-green/40', fg: 'text-green' },
    warning: { icon: _jsx(AlertTriangle, { size: 18 }), ring: 'border-warning/50', fg: 'text-warning' },
    error: { icon: _jsx(OctagonAlert, { size: 18 }), ring: 'border-red/50', fg: 'text-red' },
};
function ToastCard({ item, onDismiss }) {
    const timer = useRef(null);
    const start = useCallback(() => {
        if (item.duration > 0)
            timer.current = setTimeout(onDismiss, item.duration);
    }, [item.duration, onDismiss]);
    const stop = useCallback(() => {
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = null;
    }, []);
    useEffect(() => {
        start();
        return stop;
    }, [start, stop]);
    const k = KIND[item.kind];
    return (_jsxs("div", { role: item.kind === 'error' || item.kind === 'warning' ? 'alert' : 'status', onMouseEnter: stop, onMouseLeave: start, className: cn('pointer-events-auto flex items-start gap-3 w-full max-w-sm rounded-xl border px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]', 'bg-bg-panel/95 backdrop-blur-md text-text-primary animate-[sentinel-rise_200ms_cubic-bezier(0.16,1,0.3,1)]', k.ring), children: [_jsx("span", { className: cn('shrink-0 mt-0.5', k.fg), "aria-hidden": true, children: k.icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-sm leading-snug", children: item.message }), item.detail && _jsx("p", { className: "text-xs text-text-muted mt-1 leading-snug break-words", children: item.detail }), item.action && (_jsx("button", { type: "button", onClick: () => {
                            item.action?.onClick();
                            onDismiss();
                        }, className: cn('mt-2 text-xs font-medium underline-offset-2 hover:underline', k.fg), children: item.action.label }))] }), _jsx("button", { type: "button", "aria-label": "Dismiss", onClick: onDismiss, className: "shrink-0 -mr-1 -mt-0.5 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-card-hover", children: _jsx(X, { size: 14 }) })] }));
}
/**
 * Mount once, near the root (outside any app shell so it survives tab changes).
 * Renders the toast stack and the pending `confirm()` dialog.
 */
export function ToastProvider({ children, position = 'top-center' }) {
    const items = useSyncExternalStore(subscribe, getToasts, getToasts);
    const pending = useSyncExternalStore(subscribe, getConfirm, getConfirm);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const pos = position === 'top-center'
        ? 'top-0 left-1/2 -translate-x-1/2 items-center'
        : position === 'top-right'
            ? 'top-0 right-0 items-end'
            : position === 'bottom-center'
                ? 'bottom-0 left-1/2 -translate-x-1/2 items-center flex-col-reverse'
                : 'bottom-0 right-0 items-end flex-col-reverse';
    const vertical = position.startsWith('top')
        ? { paddingTop: 'calc(4.5rem + var(--safe-area-top, 0px))' }
        : { paddingBottom: 'calc(5rem + var(--safe-area-bottom, 0px))' };
    return (_jsxs(_Fragment, { children: [children, mounted &&
                createPortal(_jsx("div", { "aria-live": "polite", className: cn('fixed flex flex-col gap-2 p-4 pointer-events-none w-full max-w-md', pos), style: { zIndex: MODAL_Z + 100, ...vertical }, children: items.map((t) => (_jsx(ToastCard, { item: t, onDismiss: () => dismiss(t.id) }, t.id))) }), document.body), pending && (_jsx(ConfirmDialog, { open: true, title: pending.title, message: pending.message, confirmLabel: pending.confirmLabel, cancelLabel: pending.cancelLabel, tone: pending.tone, onConfirm: () => pending.resolve(true), onCancel: () => pending.resolve(false) }))] }));
}
