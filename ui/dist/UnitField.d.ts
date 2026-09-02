import React from 'react';
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
export declare const UnitField: React.ForwardRefExoticComponent<UnitFieldProps & React.RefAttributes<HTMLInputElement>>;
