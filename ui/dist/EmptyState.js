import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from './cn';
/**
 * The one empty state. Says what is missing and what to do about it, in the
 * same shape everywhere — not a bare italic sentence in one place and an
 * illustrated block in another.
 */
export function EmptyState({ icon, title, description, action, variant = 'panel', className }) {
    return (_jsxs("div", { className: cn('flex flex-col items-center justify-center text-center', variant === 'panel' ? 'rounded-xl border border-dashed border-border-color px-6 py-10 h-full min-h-40' : 'px-4 py-8', className), children: [icon && (_jsx("span", { className: "mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-card text-text-muted", "aria-hidden": true, children: icon })), _jsx("p", { className: "font-heading font-semibold text-sm text-text-primary", children: title }), description && _jsx("p", { className: "mt-1 max-w-xs text-xs text-text-muted leading-relaxed", children: description }), action && _jsx("div", { className: "mt-4", children: action })] }));
}
