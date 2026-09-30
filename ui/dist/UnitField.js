import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useId } from 'react';
import { cn } from './cn';
const TONE = {
    default: 'border-border-color focus-within:border-cyan focus-within:ring-2 focus-within:ring-cyan/40',
    warning: 'border-warning/60 focus-within:border-warning focus-within:ring-2 focus-within:ring-warning/30',
    alarm: 'border-red focus-within:border-red focus-within:ring-2 focus-within:ring-red/30',
};
const VALUE_TONE = {
    default: 'text-text-primary',
    warning: 'text-warning',
    alarm: 'text-red',
};
export const UnitField = React.forwardRef(function UnitField({ label, icon, unit, tone = 'default', fieldClassName, className, id: idProp, disabled, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    return (_jsxs("div", { className: cn('min-w-0', fieldClassName), children: [label && (_jsxs("label", { htmlFor: id, className: "mb-1.5 flex items-center gap-1.5 font-sans text-[13px] font-semibold text-text-muted", children: [icon && _jsx("span", { className: "shrink-0 text-cyan", "aria-hidden": true, children: icon }), _jsx("span", { className: "truncate", children: label })] })), _jsxs("div", { className: cn('flex items-center gap-1.5 h-12 px-3 rounded-md bg-bg-lowest border transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]', TONE[tone], disabled && 'opacity-50'), children: [_jsx("input", { ref: ref, id: id, disabled: disabled, "aria-invalid": tone === 'alarm' ? true : undefined, className: cn('w-full min-w-0 bg-transparent border-none outline-none p-0', 'font-mono text-[15px] font-medium tabular-nums', 'disabled:cursor-not-allowed placeholder:text-text-muted placeholder:font-normal', VALUE_TONE[tone], className), ...rest }), unit && (_jsx("span", { className: "shrink-0 font-mono text-[13px] text-text-muted select-none", "aria-hidden": true, children: unit }))] })] }));
});
