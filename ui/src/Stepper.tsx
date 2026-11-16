import React, { useEffect, useRef } from 'react';

/**
 * Press-and-hold numeric stepper — the fleet's control for limits, brightness and
 * thresholds. Holding a button repeats after 400 ms.
 */
import { Minus, Plus } from 'lucide-react';

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Text colour for the buttons and the filled track. Defaults to the accent. */
  colorClass?: string;
  /** Border + background (+ hover) classes for the +/- buttons. Defaults to the fleet surface tokens. */
  surfaceClassName?: string;
  /** Background class for the progress track. */
  trackClassName?: string;
}

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 100;

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  colorClass = 'text-cyan',
  surfaceClassName = 'border-border-color bg-bg-card hover:bg-bg-card-hover',
  trackClassName = 'bg-bg-card'
}: StepperProps) {
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const didRepeat = useRef(false);
  /** Which way the held button steps; 0 when nothing is held. */
  const heldDelta = useRef(0);

  /*
    The repeat timer outlives the render that started it, so it reads the
    current props from here rather than from its closure. Captured, `value` was
    whatever it was when the button went down: holding + from 5 called
    onChange(6) ten times a second and the control never got past 6.
  */
  const latest = useRef({ value, min, max, onChange });
  latest.current = { value, min, max, onChange };

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const stopHold = () => {
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimeout.current = null;
    holdInterval.current = null;
    heldDelta.current = 0;
  };

  const adjust = (delta: number) => {
    const now = latest.current;
    const next = Math.min(now.max, Math.max(now.min, Number((now.value + delta).toFixed(2))));
    if (next === now.value) {
      // At the limit: nothing left to repeat towards.
      stopHold();
      return;
    }
    now.onChange(next);
  };

  const startHold = (delta: number) => {
    // A touch is followed by the mouse events the browser makes up for it, so
    // this can be called twice for one press; the first timer must not be left
    // running with nothing holding a reference to it.
    stopHold();
    didRepeat.current = false;
    heldDelta.current = delta;
    holdTimeout.current = setTimeout(() => {
      didRepeat.current = true;
      holdInterval.current = setInterval(() => adjust(delta), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  /*
    A button that reaches its limit becomes disabled, and a disabled button
    never reports the mouse coming up, so the release that should end the hold
    does not arrive. The repeat used to run on, ten calls a second, for as long
    as the screen was open. It ends here instead, and on unmount.
  */
  useEffect(() => {
    if ((heldDelta.current < 0 && value <= min) || (heldDelta.current > 0 && value >= max)) stopHold();
  }, [value, min, max]);
  useEffect(() => stopHold, []);

  const handleClick = (delta: number) => {
    if (didRepeat.current) {
      didRepeat.current = false;
      return;
    }
    adjust(delta);
  };

  // 48px, the fleet's control size, at the control radius (8px). A state change
  // animates colour only, at the state-change speed.
  const buttonClass = `flex items-center justify-center w-12 h-12 rounded-md border ${surfaceClassName} ${colorClass} disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)] cursor-pointer shrink-0 touch-manipulation`;

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
        onTouchCancel={stopHold}
        className={buttonClass}
      >
        <Minus className="w-5 h-5" />
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
        onTouchCancel={stopHold}
        className={buttonClass}
      >
        <Plus className="w-5 h-5" />
      </button>
    </div>
  );
}
