import React from 'react';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface ToastOptions {
    /** Auto-dismiss after this many ms. Default 4500 (errors 7000). 0 keeps it until dismissed. */
    duration?: number;
    /** Optional second line. */
    detail?: React.ReactNode;
    /** Optional action button. */
    action?: {
        label: string;
        onClick: () => void;
    };
    /** Replace an existing toast with the same id instead of stacking. */
    id?: string;
}
export interface ToastItem extends Required<Pick<ToastOptions, 'id' | 'duration'>> {
    kind: ToastKind;
    message: React.ReactNode;
    detail?: React.ReactNode;
    action?: ToastOptions['action'];
}
export interface ConfirmOptions {
    title: React.ReactNode;
    message?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'default' | 'danger';
}
declare function dismiss(id: string): void;
/**
 * Imperative toast API. Works anywhere once a <ToastProvider> is mounted.
 *
 *   toast.success('Route exported');
 *   toast.error('Could not read the GPX file', { detail: err.message });
 */
export declare const toast: {
    info: (message: React.ReactNode, opts?: ToastOptions) => string;
    success: (message: React.ReactNode, opts?: ToastOptions) => string;
    warning: (message: React.ReactNode, opts?: ToastOptions) => string;
    error: (message: React.ReactNode, opts?: ToastOptions) => string;
    dismiss: typeof dismiss;
    clear: () => void;
};
/**
 * Promise-based replacement for `window.confirm`. Resolves true/false.
 *
 *   if (await confirm({ title: 'Delete this voyage?', message: '…', tone: 'danger', confirmLabel: 'Delete' })) { … }
 *
 * Only one confirm can be open at a time; a second call while one is pending
 * resolves false immediately.
 */
export declare function confirm(opts: ConfirmOptions): Promise<boolean>;
/** Hook form of the same API, for components that prefer not to import singletons. */
export declare function useToast(): {
    info: (message: React.ReactNode, opts?: ToastOptions) => string;
    success: (message: React.ReactNode, opts?: ToastOptions) => string;
    warning: (message: React.ReactNode, opts?: ToastOptions) => string;
    error: (message: React.ReactNode, opts?: ToastOptions) => string;
    dismiss: typeof dismiss;
    clear: () => void;
};
export interface ToastProviderProps {
    children?: React.ReactNode;
    /** Where the stack lives. Default 'top-center' — visible on phones and under the fleet header. */
    position?: 'top-center' | 'top-right' | 'bottom-center' | 'bottom-right';
}
/**
 * Mount once, near the root (outside any app shell so it survives tab changes).
 * Renders the toast stack and the pending `confirm()` dialog.
 */
export declare function ToastProvider({ children, position }: ToastProviderProps): React.JSX.Element;
export {};
