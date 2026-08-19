import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { cn } from './cn';
/**
 * An accessible switch. Renders as a row (label + description on one side, the
 * switch on the other) so settings lists line up without per-row layout code.
 */
export function Toggle({ checked, onChange, label, description, disabled, switchFirst = false, className, id: idProp, 'aria-label': ariaLabel }) {
    const auto = useId();
    const id = idProp ?? auto;
    const control = (_jsx("button", { id: id, type: "button", role: "switch", "aria-checked": checked, "aria-label": ariaLabel, disabled: disabled, onClick: () => onChange(!checked), className: cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app', 'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer', checked ? 'bg-cyan' : 'bg-bg-highest'), children: _jsx("span", { "aria-hidden": true, className: cn('pointer-events-none inline-block h-5 w-5 rounded-full shadow transition-transform duration-200', checked ? 'translate-x-5 bg-bg-app' : 'translate-x-0 bg-text-secondary') }) }));
    if (!label && !description)
        return _jsx("span", { className: className, children: control });
    return (_jsxs("div", { className: cn('flex items-center justify-between gap-4', switchFirst && 'flex-row-reverse justify-end', className), children: [_jsxs("label", { htmlFor: id, className: cn('min-w-0 cursor-pointer', disabled && 'cursor-not-allowed opacity-60'), children: [label && _jsx("span", { className: "block text-sm text-text-primary", children: label }), description && _jsx("span", { className: "block text-xs text-text-muted mt-0.5", children: description })] }), control] }));
}
