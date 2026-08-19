import React from 'react';
export interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: React.ReactNode;
    /** Secondary line under the label. */
    description?: React.ReactNode;
    disabled?: boolean;
    /** Put the switch before the label instead of after. */
    switchFirst?: boolean;
    className?: string;
    id?: string;
    /** Accessible name when there is no visible label. */
    'aria-label'?: string;
}
/**
 * An accessible switch. Renders as a row (label + description on one side, the
 * switch on the other) so settings lists line up without per-row layout code.
 */
export declare function Toggle({ checked, onChange, label, description, disabled, switchFirst, className, id: idProp, 'aria-label': ariaLabel }: ToggleProps): React.JSX.Element;
