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
    /**
     * Whether checking for an update can succeed here at all. False on a phone
     * with no backend, where there is nothing to ask; see `canCheckHere`.
     */
    canCheck: boolean;
    check: () => Promise<void>;
    install: () => Promise<void>;
}
/**
 * Can an update check succeed on this device?
 *
 * Three cases, and the third is the one this exists for:
 *
 *  - **Electron**: the real auto-updater is present. Always yes.
 *  - **Web, or a phone paired to a backend**: there is a server to ask. Yes,
 *    provided a `versionUrl` was given — and on a phone it has to be absolute,
 *    because that is what having a backend configured looks like.
 *  - **A phone with no backend**: all three apps build `versionUrl` from a
 *    backend address they do not have, so it comes out as a bare path. Inside a
 *    Capacitor WebView that resolves against the app's own origin, where
 *    nothing is listening, and the fetch fails **every time, by construction**.
 *    The panel used to dress that as "Could not reach the update server." — an
 *    error a customer might act on, for a check that was never going to work.
 *    Android updates arrive through the Play Store; there is no update server
 *    and there is not meant to be.
 *
 * Deliberately keyed on the URL rather than on the platform alone, so a phone
 * running in PC Server mode — which does have a backend, and an absolute URL to
 * it — keeps a check that genuinely works.
 */
export declare function canCheckHere(opts: {
    isElectron: boolean;
    versionUrl?: string;
    native?: boolean;
}): boolean;
export declare function useAppUpdater({ appName, fallbackVersion, versionUrl, checkOnMount }: UseAppUpdaterOptions): AppUpdater;
