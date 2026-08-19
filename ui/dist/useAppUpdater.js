import { useCallback, useEffect, useState } from 'react';
export function useAppUpdater({ appName, fallbackVersion, versionUrl, checkOnMount = true }) {
    const [state, setState] = useState({ status: 'idle', currentVersion: fallbackVersion, latestVersion: fallbackVersion, hasUpdate: false });
    const updater = typeof window !== 'undefined' ? window.appUpdater : undefined;
    const isElectron = !!updater?.isElectron;
    const fetchVersion = useCallback(async () => {
        if (!versionUrl)
            return;
        try {
            const res = await fetch(versionUrl);
            if (!res.ok)
                throw new Error('bad response');
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
        }
        catch {
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
                    if (!data)
                        return;
                    setState((prev) => ({
                        ...prev,
                        currentVersion: data.currentVersion ?? prev.currentVersion,
                        latestVersion: data.latestVersion,
                        hasUpdate: !!data.hasUpdate,
                        changelog: data.changelog,
                        status: data.hasUpdate ? 'available' : 'uptodate',
                    }));
                })
                    .catch(() => { });
            }
            return;
        }
        updater.getVersion().then((v) => setState((prev) => ({ ...prev, currentVersion: v }))).catch(() => { });
        const t = checkOnMount ? setTimeout(() => updater.check().catch(() => { }), 1500) : undefined;
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
            if (t)
                clearTimeout(t);
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
