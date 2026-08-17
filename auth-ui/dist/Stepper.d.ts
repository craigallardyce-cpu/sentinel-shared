import React from 'react';
export interface StepperProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    colorClass?: string;
    /** Border + background (+ hover) classes for the +/- buttons, e.g. "border-slate-700 bg-slate-800 hover:bg-slate-700". */
    surfaceClassName: string;
    /** Background class for the progress track, e.g. "bg-slate-800". */
    trackClassName: string;
}
export declare function Stepper({ value, min, max, step, onChange, colorClass, surfaceClassName, trackClassName }: StepperProps): React.JSX.Element;
