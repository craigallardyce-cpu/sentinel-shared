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
    return (_jsxs("span", { title: title, className: cn(
        // A pill in the header's status band has to be able to give ground, and
        // the label truncating is not on its own enough to let it: `nowrap`
        // makes the pill's min-content its full label width, which is the
        // automatic minimum size a flex item refuses to shrink below, so the
        // band cannot narrow and the pill ends up cut off mid-word instead.
        //
        // An explicit min-width does both halves of the job. It overrides that
        // automatic minimum, so the pill shrinks and the label ellipsises; and
        // it stops the shrinking at the dot and the padding, so the pill never
        // closes over its own contents and draws its border through them. The
        // floor is per size, because the chrome is: 8px dot + 6px gap + the
        // horizontal padding + 2px of border.
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap', size === 'sm' ? 'h-6 px-2 text-xs min-w-8' : 'h-7 px-2.5 text-sm min-w-9', c.text, c.bg, c.border, className), children: [dot, children || children === 0 ? _jsx("span", { className: "truncate", children: children }) : null] }));
}
