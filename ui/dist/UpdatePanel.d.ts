import React from 'react';
import type { AppUpdater } from './useAppUpdater';
export interface UpdatePanelProps {
    updater: AppUpdater;
    className?: string;
}
/**
 * The one updater UI: version line, a Check button, and the available /
 * downloading / ready / error states. Plain copy — "Downloading update…", not
 * "EXTRACTING & COMPILING…".
 */
export declare function UpdatePanel({ updater, className }: UpdatePanelProps): React.JSX.Element;
