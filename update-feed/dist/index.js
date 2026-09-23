/**
 * The desktop update feed, and the version check behind each app's About panel.
 *
 * HarborSentinel, OceanSentinel and VesselKeeper publish their releases to their
 * own GitHub repositories, and all three repositories are private. Anything that
 * reads those releases anonymously gets a 404: electron-updater's `github`
 * provider did, and so did each backend's `/app-version` route, which then told
 * the user "No releases published on GitHub yet" while v2.11.2 sat there with
 * its installers attached.
 *
 * The website now serves a public feed at `https://marinersentinel.com/updates/<app>/`,
 * proxying the latest release with a server-side token. electron-updater reads
 * it with the `generic` provider (configured in each app's `build.publish`), and
 * the backends read `release.json` from it through this module -- one
 * implementation instead of three that had drifted in what they returned.
 *
 * Two behaviours changed on the way, both deliberately:
 *
 *   - `hasUpdate` compares versions. The three routes used `!==`, so a machine
 *     running a newer build than the latest release was told to "update" to an
 *     older one.
 *   - A failure is a failure. A 404 used to read as "no releases yet" with
 *     `hasUpdate: false`, which is how a dead feed looked healthy for two
 *     releases. Now every failure is `ok: false`, and `appVersionHandler` answers
 *     502 so the About panel's manual check shows its error state.
 *
 * Server-side only: it uses global `fetch` (Node 18+) and has no runtime
 * dependencies, and it emits CommonJS as well as ESM because OceanSentinel's
 * backend is bundled to CJS.
 */
/** Where the website serves the feed. Each app's electron-builder `publish.url` points under it too. */
export const UPDATE_FEED_BASE = 'https://marinersentinel.com/updates';
const DEFAULT_TIMEOUT_MS = 5000;
const UNREACHABLE = 'Could not reach the update server.';
/** The feed directory for one app, with a trailing slash: `${base}/${app}/`. */
export function updateFeedUrl(app, base = UPDATE_FEED_BASE) {
    return `${base.replace(/\/+$/, '')}/${app}/`;
}
function parseVersion(v) {
    const s = String(v).trim().replace(/^v/i, '');
    const noBuild = s.split('+', 1)[0];
    const dash = noBuild.indexOf('-');
    const coreStr = dash === -1 ? noBuild : noBuild.slice(0, dash);
    const preStr = dash === -1 ? '' : noBuild.slice(dash + 1);
    const core = coreStr.split('.').map((n) => {
        const x = Number.parseInt(n, 10);
        return Number.isFinite(x) ? x : 0;
    });
    while (core.length < 3)
        core.push(0);
    return { core, pre: preStr ? preStr.split('.') : [] };
}
function comparePreIdentifier(a, b) {
    const an = /^\d+$/.test(a);
    const bn = /^\d+$/.test(b);
    if (an && bn)
        return Math.sign(Number(a) - Number(b));
    // Numeric identifiers always sort below alphanumeric ones (semver §11.4.3).
    if (an)
        return -1;
    if (bn)
        return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * Semver ordering: -1, 0 or 1. A leading `v` is ignored, build metadata is
 * ignored, and a prerelease sorts below its release (`2.12.0-beta.1 < 2.12.0`).
 */
export function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    const len = Math.max(pa.core.length, pb.core.length);
    for (let i = 0; i < len; i++) {
        const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
        if (d !== 0)
            return Math.sign(d);
    }
    if (pa.pre.length === 0 && pb.pre.length === 0)
        return 0;
    if (pa.pre.length === 0)
        return 1;
    if (pb.pre.length === 0)
        return -1;
    const plen = Math.max(pa.pre.length, pb.pre.length);
    for (let i = 0; i < plen; i++) {
        if (pa.pre[i] === undefined)
            return -1;
        if (pb.pre[i] === undefined)
            return 1;
        const d = comparePreIdentifier(pa.pre[i], pb.pre[i]);
        if (d !== 0)
            return d;
    }
    return 0;
}
const VERSION_SHAPE = /^v?\d+\.\d+\.\d+/;
/**
 * Ask the feed for the latest release and compare it with the running version.
 *
 * Never throws. A non-OK status (404 included), a network error, a timeout or a
 * body that is not the feed's `release.json` all give `ok: false` with one
 * user-facing message; which of them it was is not something the About panel
 * can act on.
 */
export async function checkLatestRelease(opts) {
    const { app, currentVersion } = opts;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const failed = { ok: false, currentVersion, error: UNREACHABLE };
    const controller = new AbortController();
    let timer;
    // Raced as well as aborted, so a fetch that ignores its signal still times out.
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
        }, timeoutMs);
    });
    try {
        const body = await Promise.race([
            (async () => {
                const res = await fetchImpl(`${updateFeedUrl(app, opts.baseUrl)}release.json`, {
                    headers: { Accept: 'application/json' },
                    signal: controller.signal,
                });
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
                return (await res.json());
            })(),
            timeout,
        ]);
        if (!body || typeof body !== 'object')
            return failed;
        const { version, notes } = body;
        if (typeof version !== 'string' || !VERSION_SHAPE.test(version.trim()))
            return failed;
        if (notes !== undefined && !Array.isArray(notes))
            return failed;
        const latestVersion = version.trim().replace(/^v/i, '');
        const changelog = (Array.isArray(notes) ? notes : []).filter((n) => typeof n === 'string').join('\n');
        return {
            ok: true,
            currentVersion,
            latestVersion,
            hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
            changelog,
        };
    }
    catch {
        return failed;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/**
 * A request handler for each backend's `/app-version` route.
 *
 * 200 `{ currentVersion, latestVersion, hasUpdate, changelog }` when the feed
 * answers; 502 `{ currentVersion, error }` when it does not. `@sentinel/ui`'s
 * `useAppUpdater` shows the 502 as its error state on a manual check and stays
 * quiet on its mount-time one.
 */
export function appVersionHandler(opts) {
    return async (_req, res) => {
        const result = await checkLatestRelease({
            app: opts.app,
            currentVersion: opts.getCurrentVersion(),
            baseUrl: opts.baseUrl,
            timeoutMs: opts.timeoutMs,
            fetchImpl: opts.fetchImpl,
        });
        if (result.ok) {
            const { currentVersion, latestVersion, hasUpdate, changelog } = result;
            res.status(200).json({ currentVersion, latestVersion, hasUpdate, changelog });
        }
        else {
            res.status(502).json({ currentVersion: result.currentVersion, error: result.error });
        }
    };
}
