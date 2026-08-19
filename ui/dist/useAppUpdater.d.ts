/**
 * The renderer side of @sentinel/electron-shell's auto-updater.
 *
 * Events arrive over `window.appUpdater.onEvent` (see electron-shell
 * setupAutoUpdater: checking / available / not-available / download-progress /
 * downloaded / error). Outside Electron (web, Capacitor) the hook falls back to a
 * display-only version check against `versionUrl`, if one is given.
 *
 * All three apps carried this exact reducer; this is the one copy.
 */
export type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'updating' | 'error';
export interface UpdateState {
    status: UpdateStatus;
    currentVersion?: string;
    latestVersion?: string;
    hasUpdate?: boolean;
    /** Download finished; `install()` will restart into it. */
    updateReady?: boolean;
    /** 0–100 while downloading. */
    progress?: number;
    changelog?: string;
    errorMsg?: string;
}
export interface UseAppUpdaterOptions {
    /** Shown in the "desktop only" error. */
    appName: string;
    /** Version known at build time, e.g. `import.meta.env.PACKAGE_VERSION`. */
    fallbackVersion?: string;
    /** Non-Electron fallback: GET returns { currentVersion, latestVersion, hasUpdate, changelog? }. */
    versionUrl?: string;
    /** In Electron, ask the updater to check shortly after mount. Default true. */
    checkOnMount?: boolean;
}
export interface AppUpdaterApi {
    isElectron: boolean;
    getVersion: () => Promise<string>;
    check: () => Promise<unknown>;
    install: () => Promise<{
        ok: boolean;
        error?: string;
    } | undefined>;
    onEvent: (cb: (data: {
        type: string;
        version?: string;
        percent?: number;
        message?: string;
    }) => void) => () => void;
}
declare global {
    interface Window {
        appUpdater?: AppUpdaterApi;
    }
}
export interface AppUpdater {
    state: UpdateState;
    isElectron: boolean;
    check: () => Promise<void>;
    install: () => Promise<void>;
}
export declare function useAppUpdater({ appName, fallbackVersion, versionUrl, checkOnMount }: UseAppUpdaterOptions): AppUpdater;
