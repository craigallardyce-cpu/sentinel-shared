import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from './cn';
const LABEL = {
    account: 'Account',
    vessel: 'Boat',
    host: 'This PC',
    device: 'This device',
    default: 'Default',
    unset: 'Not set',
};
const DESCRIPTION = {
    account: 'Set for your account — applies on every device you sign in on.',
    vessel: 'Set for this boat — shared with the other MarinerSentinel apps.',
    host: 'Set on the machine running the backend, shared by everything pointed at it.',
    device: 'Set on this device only, overriding anything broader.',
    default: 'Nobody has changed this; it is the value the app ships with.',
    unset: 'Nobody has set this yet.',
};
export function ScopeBadge({ source, hideWhenUnset = false, className }) {
    if (hideWhenUnset && (source === 'default' || source === 'unset'))
        return null;
    // Narrower than the layers beneath it, so it is the one worth pointing at.
    const isOverride = source === 'device' || source === 'host';
    // Only the dot is drawn. The word is visually hidden, not removed: it is the
    // badge's accessible name, and it carries the tooltip too, so hovering or
    // finding the badge by its text reaches the same explanation.
    return (_jsxs("span", { title: DESCRIPTION[source], "data-source": source, className: cn('inline-flex items-center shrink-0 align-middle leading-none', isOverride ? 'text-text-secondary' : 'text-text-muted', className), children: [_jsx("span", { "aria-hidden": true, className: cn('inline-block h-1.5 w-1.5 rounded-full', isOverride ? 'bg-current' : 'border border-current') }), _jsx("span", { className: "sr-only", title: DESCRIPTION[source], children: LABEL[source] })] }));
}
export function ClearOverride({ fallsBackTo, onClear, disabled, className }) {
    return (_jsx("button", { type: "button", onClick: onClear, disabled: disabled, title: `Remove this device's value and use the ${LABEL[fallsBackTo].toLowerCase()} one instead.`, className: cn('shrink-0 h-10 px-3 rounded-md text-[13px] font-semibold text-text-secondary', 'hover:text-text-primary hover:bg-bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer', className), children: "Clear override" }));
}
