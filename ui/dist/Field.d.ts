import React from 'react';
interface FieldChrome {
    label?: React.ReactNode;
    /** Helper text under the control. */
    hint?: React.ReactNode;
    /** Validation message. When set, the control is drawn in the alarm colour and `aria-invalid`. */
    error?: React.ReactNode;
    /** Marks the label with a required indicator (also sets the `required` attribute). */
    required?: boolean;
    /** Wrapper class for the whole field (label + control + hint). */
    fieldClassName?: string;
}
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, FieldChrome {
    /** Element drawn inside the control on the left (e.g. a lucide icon). */
    leading?: React.ReactNode;
    /** Element drawn inside the control on the right (e.g. a unit suffix). */
    trailing?: React.ReactNode;
}
export declare const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>;
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChrome {
}
export declare const Textarea: React.ForwardRefExoticComponent<TextareaProps & React.RefAttributes<HTMLTextAreaElement>>;
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, FieldChrome {
}
export declare const Select: React.ForwardRefExoticComponent<SelectProps & React.RefAttributes<HTMLSelectElement>>;
export {};
