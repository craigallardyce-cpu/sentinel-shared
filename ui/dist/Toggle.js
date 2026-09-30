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
    const control = (_jsx("button", { id: id, type: "button", role: "switch", "aria-checked": checked, "aria-label": ariaLabel, disabled: disabled, onClick: () => onChange(!checked), className: cn(
        // 56x32 (fit-and-finish control sizes), up from 52x30 and from the
        // conventional 44x24 before that: this is the control a watchkeeper
        // flips on a phone at anchor. The knob geometry below follows from it.
        'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-[3px] border-transparent', 'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app', 'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer', checked ? 'bg-cyan' : 'bg-bg-highest'), children: _jsx("span", { "aria-hidden": true, className: cn(
            // 26px knob inside a 50x26 content box (56x32 less the 3px border),
            // so it sits 3px in from every edge and travels 50 - 26 = 24px.
            // No shadow: the knob is told apart by its fill.
            'pointer-events-none inline-block h-[26px] w-[26px] rounded-full', 'transition-transform duration-[var(--motion-state)] ease-[var(--motion-ease)]', checked ? 'translate-x-6 bg-bg-app' : 'translate-x-0 bg-text-secondary') }) }));
    if (!label && !description)
        return _jsx("span", { className: className, children: control });
    return (_jsxs("div", { className: cn('flex items-center justify-between gap-4', switchFirst && 'flex-row-reverse justify-end', className), children: [_jsxs("label", { htmlFor: id, className: cn('min-w-0 cursor-pointer', disabled && 'cursor-not-allowed opacity-60'), children: [label && _jsx("span", { className: "block text-[15px] text-text-primary", children: label }), description && _jsx("span", { className: "block text-[13px] text-text-muted mt-1", children: description })] }), control] }));
}
