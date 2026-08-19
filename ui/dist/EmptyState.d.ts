import React from 'react';
export interface EmptyStateProps {
    /** A lucide icon element, e.g. `<Radio size={28} />`. */
    icon?: React.ReactNode;
    title: React.ReactNode;
    /** One or two sentences: what would normally be here and how to get it. */
    description?: React.ReactNode;
    /** Usually a `<Button>`. */
    action?: React.ReactNode;
    /** `panel` draws the dashed frame (for a whole empty pane); `inline` is a quiet centred block for a table body or list. */
    variant?: 'panel' | 'inline';
    className?: string;
}
/**
 * The one empty state. Says what is missing and what to do about it, in the
 * same shape everywhere — not a bare italic sentence in one place and an
 * illustrated block in another.
 */
export declare function EmptyState({ icon, title, description, action, variant, className }: EmptyStateProps): React.JSX.Element;
