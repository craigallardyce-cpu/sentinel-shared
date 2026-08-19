import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from './cn';
export const STATUS_CLASS = {
    ok: { text: 'text-green', dot: 'bg-green', bg: 'bg-green/10', border: 'border-green/30' },
    warning: { text: 'text-warning', dot: 'bg-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
    alarm: { text: 'text-red', dot: 'bg-red', bg: 'bg-red/10', border: 'border-red/40' },
    offline: { text: 'text-text-muted', dot: 'bg-text-muted', bg: 'bg-bg-card', border: 'border-border-color' },
    info: { text: 'text-cyan', dot: 'bg-cyan', bg: 'bg-cyan/10', border: 'border-cyan/30' },
};
export function StatusPill({ status, children, pulse = false, compact = false, size = 'sm', className, title }) {
    const c = STATUS_CLASS[status];
    const dot = (_jsxs("span", { className: "relative flex h-2 w-2 shrink-0", "aria-hidden": true, children: [pulse && _jsx("span", { className: cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', c.dot) }), _jsx("span", { className: cn('relative inline-flex h-2 w-2 rounded-full', c.dot) })] }));
    if (compact) {
        return (_jsx("span", { className: cn('inline-flex items-center', className), title: title, role: "img", "aria-label": title ?? status, children: dot }));
    }
    return (_jsxs("span", { title: title, className: cn('inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap', size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm', c.text, c.bg, c.border, className), children: [dot, children] }));
}
