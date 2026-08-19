import React, { useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  colorClass?: string;
  /** Border + background (+ hover) classes for the +/- buttons, e.g. "border-border-color bg-bg-card hover:bg-bg-card-hover". */
  surfaceClassName: string;
  /** Background class for the progress track, e.g. "bg-bg-card". */
  trackClassName: string;
}

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 100;

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  colorClass = 'text-current',
  surfaceClassName,
  trackClassName
}: StepperProps) {
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const didRepeat = useRef(false);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const adjust = (delta: number) => onChange(clamp(Number((value + delta).toFixed(2))));

  const startHold = (delta: number) => {
    didRepeat.current = false;
    holdTimeout.current = setTimeout(() => {
      didRepeat.current = true;
      holdInterval.current = setInterval(() => adjust(delta), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const stopHold = () => {
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimeout.current = null;
    holdInterval.current = null;
  };

  const handleClick = (delta: number) => {
    if (didRepeat.current) {
      didRepeat.current = false;
      return;
    }
    adjust(delta);
  };

  const buttonClass = `flex items-center justify-center w-9 h-9 rounded-lg border ${surfaceClassName} ${colorClass} disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all cursor-pointer shrink-0 touch-manipulation`;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => handleClick(-step)}
        onMouseDown={() => startHold(-step)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={() => startHold(-step)}
        onTouchEnd={stopHold}
        className={buttonClass}
      >
        <Minus className="w-4 h-4" />
      </button>
      <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${trackClassName}`}>
        <div
          className={`h-full rounded-full bg-current ${colorClass} transition-[width]`}
          style={{ width: `${((clamp(value) - min) / (max - min)) * 100}%` }}
        />
      </div>
      <button
        type="button"
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => handleClick(step)}
        onMouseDown={() => startHold(step)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={() => startHold(step)}
        onTouchEnd={stopHold}
        className={buttonClass}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
