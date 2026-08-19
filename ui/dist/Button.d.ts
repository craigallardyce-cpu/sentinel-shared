import React from 'react';
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Icon rendered before the label. Pass a lucide element, e.g. `<Save size={16} />`. */
    icon?: React.ReactNode;
    /** Shows a spinner and disables the button. */
    loading?: boolean;
    /** Stretch to the container width. */
    block?: boolean;
}
/**
 * The fleet button. Labels are sentence case ("Save changes", not "SAVE & APPLY").
 * `primary` is for the one main action on a surface; `danger` for destructive
 * actions; everything else is `secondary` or `ghost`.
 */
export declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
