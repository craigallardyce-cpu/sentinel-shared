import React from 'react';
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    /** One line under the title. */
    description?: React.ReactNode;
    /** Icon drawn before the title (e.g. `<Settings size={18} />`). */
    icon?: React.ReactNode;
    size?: ModalSize;
    /** Footer content — usually `<Button>`s. Laid out right-aligned. */
    footer?: React.ReactNode;
    /** Close when the scrim is clicked. Default true. */
    closeOnBackdrop?: boolean;
    /** Close on Escape. Default true. */
    closeOnEscape?: boolean;
    /** Hide the × button. */
    hideClose?: boolean;
    /** Class for the scrollable body. */
    bodyClassName?: string;
    /** Class for the panel. */
    className?: string;
    /** Draws the panel with the alarm treatment (red border + glow). */
    tone?: 'default' | 'danger';
    children?: React.ReactNode;
}
/** z-index of the modal layer. Toasts sit above it (see Toast.tsx). */
export declare const MODAL_Z = 1100;
/**
 * The fleet dialog: one scrim, one radius, one motion, focus trapped, Escape
 * closes. Use it for every overlay that blocks the page — settings, editors,
 * confirmations — instead of a hand-rolled fixed div.
 */
export declare function Modal({ open, onClose, title, description, icon, size, footer, closeOnBackdrop, closeOnEscape, hideClose, bodyClassName, className, tone, children, }: ModalProps): React.ReactPortal | null;
export interface ConfirmDialogProps {
    open: boolean;
    title: React.ReactNode;
    message?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** `danger` draws the confirm button and panel in the alarm colour. */
    tone?: 'default' | 'danger';
    onConfirm: () => void;
    onCancel: () => void;
    /** Shows a spinner on the confirm button. */
    busy?: boolean;
}
/** A yes/no question. For one-off use from code, prefer `confirm()` from Toast.tsx. */
export declare function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, tone, onConfirm, onCancel, busy, }: ConfirmDialogProps): React.JSX.Element;
