import React from 'react';
export interface TabItem {
    id: string;
    label: React.ReactNode;
    /** A quiet mono number after the label: items on the tab, not a badge. */
    count?: number;
}
export interface TabsProps {
    items: TabItem[];
    /** The selected tab's id. */
    value: string;
    onChange: (id: string) => void;
    /**
     * Adds a tab. When set, a single + button follows the strip; there is no
     * other way to add one, so there is never a second, differently placed Add.
     */
    onAdd?: () => void;
    /** Accessible name and tooltip for the + button. Default "New tab". */
    addLabel?: string;
    /** Accessible name for the tab list. */
    'aria-label'?: string;
    /**
     * Prefix for the tab and panel ids. When set, each tab gets
     * `id="{prefix}-tab-{id}"` and `aria-controls="{prefix}-panel-{id}"`, so the
     * caller's panels can be `id="{prefix}-panel-{id}"` with
     * `aria-labelledby="{prefix}-tab-{id}"`.
     */
    idPrefix?: string;
    /** Class for the strip (the element that carries the bottom hairline). */
    className?: string;
}
/**
 * The fleet tab strip (fit-and-finish V9): one way to draw tabs, and one way to
 * add one.
 *
 * Sentence case, Inter 15/600, 48px targets. The selected tab is marked by a
 * 2px accent stroke along its bottom edge, sitting on the strip's own hairline;
 * no boxes, no pills and no icons. A count is a quiet mono numeral beside the
 * label, not a badge.
 *
 * Keyboard: the strip is one tab stop. Left and Right move between tabs and
 * select as they go (they wrap); Home and End jump to the ends.
 */
export declare function Tabs({ items, value, onChange, onAdd, addLabel, 'aria-label': ariaLabel, idPrefix, className, }: TabsProps): React.JSX.Element;
