import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
const CONTROL = 'w-full h-10 px-3 text-sm rounded-lg bg-bg-lowest text-text-primary placeholder:text-text-muted border transition-colors ' +
    'focus:outline-none focus:ring-2 focus:ring-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed';
const CONTROL_OK = 'border-border-color focus:border-cyan';
const CONTROL_ERR = 'border-red focus:border-red focus:ring-red/30';
function Label({ htmlFor, required, children }) {
    return (_jsxs("label", { htmlFor: htmlFor, className: "block text-xs font-medium text-text-secondary mb-1.5", children: [children, required && _jsx("span", { className: "text-red ml-0.5", "aria-hidden": true, children: "*" })] }));
}
function Below({ id, hint, error }) {
    if (!hint && !error)
        return null;
    return (_jsx("p", { id: id, className: cn('mt-1.5 text-xs', error ? 'text-red' : 'text-text-muted'), role: error ? 'alert' : undefined, children: error || hint }));
}
export const Input = React.forwardRef(function Input({ label, hint, error, required, fieldClassName, leading, trailing, className, id: idProp, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    const descId = `${id}-desc`;
    return (_jsxs("div", { className: fieldClassName, children: [label && _jsx(Label, { htmlFor: id, required: required, children: label }), _jsxs("div", { className: "relative", children: [leading && _jsx("span", { className: "absolute inset-y-0 left-3 flex items-center text-text-muted pointer-events-none", children: leading }), _jsx("input", { ref: ref, id: id, required: required, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? descId : undefined, className: cn(CONTROL, error ? CONTROL_ERR : CONTROL_OK, leading && 'pl-9', trailing && 'pr-10', className), ...rest }), trailing && _jsx("span", { className: "absolute inset-y-0 right-3 flex items-center text-text-muted text-xs pointer-events-none", children: trailing })] }), _jsx(Below, { id: descId, hint: hint, error: error })] }));
});
export const Textarea = React.forwardRef(function Textarea({ label, hint, error, required, fieldClassName, className, id: idProp, rows = 3, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    const descId = `${id}-desc`;
    return (_jsxs("div", { className: fieldClassName, children: [label && _jsx(Label, { htmlFor: id, required: required, children: label }), _jsx("textarea", { ref: ref, id: id, rows: rows, required: required, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? descId : undefined, className: cn(CONTROL, 'h-auto py-2 resize-y', error ? CONTROL_ERR : CONTROL_OK, className), ...rest }), _jsx(Below, { id: descId, hint: hint, error: error })] }));
});
export const Select = React.forwardRef(function Select({ label, hint, error, required, fieldClassName, className, id: idProp, children, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    const descId = `${id}-desc`;
    return (_jsxs("div", { className: fieldClassName, children: [label && _jsx(Label, { htmlFor: id, required: required, children: label }), _jsxs("div", { className: "relative", children: [_jsx("select", { ref: ref, id: id, required: required, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? descId : undefined, className: cn(CONTROL, 'appearance-none pr-9 cursor-pointer', error ? CONTROL_ERR : CONTROL_OK, className), ...rest, children: children }), _jsx(ChevronDown, { size: 16, className: "absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none", "aria-hidden": true })] }), _jsx(Below, { id: descId, hint: hint, error: error })] }));
});
