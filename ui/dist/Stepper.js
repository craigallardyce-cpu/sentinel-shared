import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from 'react';
/**
 * Press-and-hold numeric stepper — the fleet's control for limits, brightness and
 * thresholds. Holding a button repeats after 400 ms.
 */
import { Minus, Plus } from 'lucide-react';
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 100;
export function Stepper({ value, min, max, step = 1, onChange, colorClass = 'text-cyan', surfaceClassName = 'border-border-color bg-bg-card hover:bg-bg-card-hover', trackClassName = 'bg-bg-card' }) {
    const holdTimeout = useRef(null);
    const holdInterval = useRef(null);
    const didRepeat = useRef(false);
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const adjust = (delta) => onChange(clamp(Number((value + delta).toFixed(2))));
    const startHold = (delta) => {
        didRepeat.current = false;
        holdTimeout.current = setTimeout(() => {
            didRepeat.current = true;
            holdInterval.current = setInterval(() => adjust(delta), HOLD_REPEAT_MS);
        }, HOLD_DELAY_MS);
    };
    const stopHold = () => {
        if (holdTimeout.current)
            clearTimeout(holdTimeout.current);
        if (holdInterval.current)
            clearInterval(holdInterval.current);
        holdTimeout.current = null;
        holdInterval.current = null;
    };
    const handleClick = (delta) => {
        if (didRepeat.current) {
            didRepeat.current = false;
            return;
        }
        adjust(delta);
    };
    const buttonClass = `flex items-center justify-center w-11 h-11 rounded-lg border ${surfaceClassName} ${colorClass} disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all cursor-pointer shrink-0 touch-manipulation`;
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", "aria-label": "Decrease", disabled: value <= min, onClick: () => handleClick(-step), onMouseDown: () => startHold(-step), onMouseUp: stopHold, onMouseLeave: stopHold, onTouchStart: () => startHold(-step), onTouchEnd: stopHold, className: buttonClass, children: _jsx(Minus, { className: "w-4 h-4" }) }), _jsx("div", { className: `flex-1 h-1.5 rounded-full overflow-hidden ${trackClassName}`, children: _jsx("div", { className: `h-full rounded-full bg-current ${colorClass} transition-[width]`, style: { width: `${((clamp(value) - min) / (max - min)) * 100}%` } }) }), _jsx("button", { type: "button", "aria-label": "Increase", disabled: value >= max, onClick: () => handleClick(step), onMouseDown: () => startHold(step), onMouseUp: stopHold, onMouseLeave: stopHold, onTouchStart: () => startHold(step), onTouchEnd: stopHold, className: buttonClass, children: _jsx(Plus, { className: "w-4 h-4" }) })] }));
}
