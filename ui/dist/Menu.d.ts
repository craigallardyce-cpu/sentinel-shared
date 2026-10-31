import React from 'react';
/**
 * The small pop-over menu the fleet hangs off a button: VesselKeeper's row
 * actions, View menu and Maintenance tab options, OceanSentinel's Ship's Log ⋮
 * menu and its VHF conversation menu. Moved here from VesselKeeper
 * (`src/client/components/Menu.tsx`, fit-and-finish V6, V7, V9) so the three
 * apps draw one menu and close it one way.
 *
 * One look -- a floating surface (radius 16, the one panel shadow), 48px rows
 * in sentence case -- and one way to close: a press outside, or Escape. Inside
 * the panel the arrow keys, Home and End move between the items.
 *
 * Usage: a `relative` wrapper holding the trigger and the panel, with
 * `useDismiss(wrapperRef, open, close)` on the wrapper, so a press on the
 * trigger itself is not "outside".
 */
export declare function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void;
export interface MenuPanelProps {
    /** Which edge of the trigger the panel lines up with. */
    align?: 'start' | 'end';
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
    /** Accessible name for the menu. */
    label?: string;
}
export declare function MenuPanel({ align, className, style, children, label }: MenuPanelProps): React.JSX.Element;
export interface MenuItemProps {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    icon?: React.ReactNode;
    /** `danger` for a destructive item; the colour states the consequence. */
    tone?: 'default' | 'danger';
    disabled?: boolean;
    children: React.ReactNode;
    /** A second, quieter line under the label. */
    hint?: React.ReactNode;
}
export declare function MenuItem({ onClick, icon, tone, disabled, children, hint }: MenuItemProps): React.JSX.Element;
export declare function MenuDivider(): React.JSX.Element;
