import React, { useId } from 'react';
import { cn } from './cn';

/**
 * A number with a unit welded to it — a bearing, a scope, a wind limit, a depth
 * alarm. The instrument counterpart to `Input`.
 *
 * `Input` is a form row: label above, control, hint below, laid out for a
 * dialog. Instrument panels want something else — a tight cell in a two-up
 * grid, with the unit sitting inside the box beside the figure rather than
 * floating in the label. Dropping `Input` into HarborSentinel's anchor-watch
 * panel roughly doubled its height, which is why that panel hand-rolled a bare
 * `<input>` inside a styled `<div>` instead, and why the fleet has several
 * slightly different versions of the same cell.
 *
 * The control is still 44px, because these are touched at anchor. The saving
 * against `Input` is the chrome around it, not the target itself.
 *
 * ```tsx
 * <UnitField label="Scope" icon={<Ruler size={14} />} unit=":1"
 *            type="number" value={scope} onChange={…} />
 * ```
 */
export interface UnitFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Short, and a noun: "Scope", "Bearing", "Wind". */
  label?: React.ReactNode;
  /** A lucide element drawn before the label, e.g. `<Ruler size={14} />`. */
  icon?: React.ReactNode;
  /** Sits inside the box after the figure: `ft`, `°`, `kts`, `:1`. */
  unit?: React.ReactNode;
  /**
   * Draws the box in a status colour when the value itself is the problem —
   * a depth under the alarm, a wind over the limit. `alarm` also sets
   * `aria-invalid`.
   */
  tone?: 'default' | 'warning' | 'alarm';
  /** Class for the whole field, label included. */
  fieldClassName?: string;
}

const TONE: Record<NonNullable<UnitFieldProps['tone']>, string> = {
  default: 'border-border-color focus-within:border-cyan focus-within:ring-2 focus-within:ring-cyan/40',
  warning: 'border-warning/60 focus-within:border-warning focus-within:ring-2 focus-within:ring-warning/30',
  alarm: 'border-red focus-within:border-red focus-within:ring-2 focus-within:ring-red/30',
};

const VALUE_TONE: Record<NonNullable<UnitFieldProps['tone']>, string> = {
  default: 'text-text-primary',
  warning: 'text-warning',
  alarm: 'text-red',
};

export const UnitField = React.forwardRef<HTMLInputElement, UnitFieldProps>(function UnitField(
  { label, icon, unit, tone = 'default', fieldClassName, className, id: idProp, disabled, ...rest },
  ref
) {
  const auto = useId();
  const id = idProp ?? auto;

  return (
    <div className={cn('min-w-0', fieldClassName)}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-text-muted"
        >
          {icon && <span className="shrink-0 text-cyan" aria-hidden>{icon}</span>}
          <span className="truncate">{label}</span>
        </label>
      )}
      {/* The box carries the border and the focus ring, so the unit sits inside
          the control rather than beside it — focus-within is what makes that
          read as one field instead of an input with a label stuck on. */}
      <div
        className={cn(
          'flex items-center gap-1 h-11 px-2.5 rounded-md bg-bg-lowest border transition-colors',
          TONE[tone],
          disabled && 'opacity-50',
        )}
      >
        <input
          ref={ref}
          id={id}
          disabled={disabled}
          aria-invalid={tone === 'alarm' ? true : undefined}
          className={cn(
            'w-full min-w-0 bg-transparent border-none outline-none p-0',
            'font-mono text-sm font-bold tabular-nums',
            'disabled:cursor-not-allowed placeholder:text-text-muted placeholder:font-normal',
            VALUE_TONE[tone],
            className,
          )}
          {...rest}
        />
        {unit && (
          <span className="shrink-0 font-mono text-[12px] text-text-muted select-none" aria-hidden>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
});
