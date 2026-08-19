import React from 'react';
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
export declare function Stepper({ value, min, max, step, onChange, colorClass, surfaceClassName, trackClassName }: StepperProps): React.JSX.Element;
