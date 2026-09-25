/**
 * Open a website in the system browser, from any of the fleet's three shells.
 *
 * One call, `window.open(url, '_blank', 'noopener,noreferrer')`, because it is
 * the one that works in all three:
 *
 *   - **Electron.** Each app's `main.cjs` installs a `setWindowOpenHandler`
 *     that hands every URL other than its own localhost server to
 *     `shell.openExternal` and denies the window. So `_blank` reaches the
 *     system browser and no second frameless window appears.
 *   - **Capacitor (Android).** Tested on a real phone on 2026-09-25 through
 *     OceanSentinel's vessel-profile link, which is this exact call: it opens
 *     the system browser. HarborSentinel's `lib/openExternal.ts` built and
 *     clicked a `target="_blank"` anchor on the theory that `window.open` is
 *     dropped by Capacitor's WebView; that theory is disproved, and the anchor
 *     is no longer needed.
 *   - **The browser build.** A new tab, with no `window.opener` and no
 *     referrer: the website has no business holding a handle on the app.
 *
 * Only `http:` and `https:` are opened. Electron's handlers pass whatever they
 * are given to `shell.openExternal`, which will launch `file:`, custom-scheme
 * and other handlers on the host, so a URL that came from data (a stored
 * document, a vessel profile) must not be able to reach it as anything but a
 * web page. Relative URLs are refused for the same reason: they resolve
 * against the app's own origin, which is `file:` or `capacitor:` in a build.
 *
 * Returns `true` when the URL was accepted and handed to `window.open`, and
 * `false` when it was refused or `window.open` threw. It cannot report whether
 * a window actually appeared: with `noopener`, the HTML spec has `window.open`
 * return `null` even on success, and Electron returns `null` too because its
 * handler denies the window after opening the system browser. So `false` means
 * "certainly did not open", and `true` means "asked the platform to open it".
 */
export function openExternal(url) {
    if (!isWebUrl(url))
        return false;
    if (typeof window === 'undefined' || typeof window.open !== 'function')
        return false;
    try {
        window.open(url.trim(), '_blank', 'noopener,noreferrer');
        return true;
    }
    catch {
        return false;
    }
}
/** An absolute `http:` or `https:` URL. Exported for callers that want to validate before offering a link. */
export function isWebUrl(url) {
    if (typeof url !== 'string' || url.trim() === '')
        return false;
    let parsed;
    try {
        // No base: a relative URL throws, which is the point.
        parsed = new URL(url.trim());
    }
    catch {
        return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
