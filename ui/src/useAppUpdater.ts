import { useCallback, useEffect, useState } from 'react';

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
  install: () => Promise<{ ok: boolean; error?: string } | undefined>;
  onEvent: (cb: (data: { type: string; version?: string; percent?: number; message?: string }) => void) => () => void;
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

export function useAppUpdater({ appName, fallbackVersion, versionUrl, checkOnMount = true }: UseAppUpdaterOptions): AppUpdater {
  const [state, setState] = useState<UpdateState>({ status: 'idle', currentVersion: fallbackVersion, latestVersion: fallbackVersion, hasUpdate: false });
  const updater = typeof window !== 'undefined' ? window.appUpdater : undefined;
  const isElectron = !!updater?.isElectron;

  const fetchVersion = useCallback(async () => {
    if (!versionUrl) return;
    try {
      const res = await fetch(versionUrl);
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        currentVersion: data.currentVersion ?? prev.currentVersion,
        latestVersion: data.latestVersion,
        hasUpdate: !!data.hasUpdate,
        changelog: data.changelog,
        status: data.hasUpdate ? 'available' : 'uptodate',
        errorMsg: undefined,
      }));
    } catch {
      setState((prev) => ({ ...prev, status: 'error', errorMsg: 'Could not reach the update server.' }));
    }
  }, [versionUrl]);

  useEffect(() => {
    if (!updater?.isElectron) {
      // Display-only: learn the versions without flagging an error when offline.
      if (versionUrl) {
        fetch(versionUrl)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (!data) return;
            setState((prev) => ({
              ...prev,
              currentVersion: data.currentVersion ?? prev.currentVersion,
              latestVersion: data.latestVersion,
              hasUpdate: !!data.hasUpdate,
              changelog: data.changelog,
              status: data.hasUpdate ? 'available' : 'uptodate',
            }));
          })
          .catch(() => {});
      }
      return;
    }
    updater.getVersion().then((v) => setState((prev) => ({ ...prev, currentVersion: v }))).catch(() => {});
    const t = checkOnMount ? setTimeout(() => updater.check().catch(() => {}), 1500) : undefined;
    const off = updater.onEvent((data) => {
      switch (data.type) {
        case 'checking':
          setState((prev) => ({ ...prev, status: 'checking', errorMsg: undefined }));
          break;
        case 'available':
          setState((prev) => ({ ...prev, status: 'available', latestVersion: data.version, hasUpdate: true, updateReady: false, progress: undefined }));
          break;
        case 'not-available':
          setState((prev) => ({ ...prev, status: 'uptodate', hasUpdate: false, updateReady: false }));
          break;
        case 'download-progress':
          setState((prev) => ({ ...prev, status: 'updating', progress: Math.round(data.percent ?? 0) }));
          break;
        case 'downloaded':
          setState((prev) => ({ ...prev, status: 'available', updateReady: true, latestVersion: data.version || prev.latestVersion, progress: 100 }));
          break;
        case 'error':
          setState((prev) => ({ ...prev, status: 'error', errorMsg: data.message }));
          break;
      }
    });
    return () => {
      if (t) clearTimeout(t);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron, versionUrl]);

  const check = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'checking', errorMsg: undefined }));
    if (updater?.isElectron) {
      await updater.check(); // result arrives via onEvent
      return;
    }
    await fetchVersion();
  }, [updater, fetchVersion]);

  const install = useCallback(async () => {
    if (!updater?.isElectron) {
      setState((prev) => ({ ...prev, status: 'error', errorMsg: `Updates install from the ${appName} desktop app.` }));
      return;
    }
    const result = await updater.install();
    if (result && result.ok === false) {
      setState((prev) => ({ ...prev, status: 'error', errorMsg: result.error || 'The update is not ready to install yet.' }));
    }
    // On success the app quits and relaunches on the new version.
  }, [updater, appName]);

  return { state, isElectron, check, install };
}
