import { jsx as _jsx } from "react/jsx-runtime";
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
    return (_jsx("span", { role: "img", "aria-label": LABEL[source], title: `${LABEL[source]}: ${DESCRIPTION[source]}`, "data-source": source, className: cn('inline-block shrink-0 h-1.5 w-1.5 rounded-full align-middle', isOverride ? 'bg-text-secondary' : 'border border-text-muted', className) }));
}
export function ClearOverride({ fallsBackTo, onClear, disabled, className }) {
    return (_jsx("button", { type: "button", onClick: onClear, disabled: disabled, title: `Remove this device's value and use the ${LABEL[fallsBackTo].toLowerCase()} one instead.`, className: cn('shrink-0 h-10 px-3 rounded-md text-[13px] font-semibold text-text-secondary', 'hover:text-text-primary hover:bg-bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer', className), children: "Clear override" }));
}
