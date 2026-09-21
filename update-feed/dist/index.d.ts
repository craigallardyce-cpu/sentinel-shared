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
export type FleetApp = 'harborsentinel' | 'oceansentinel' | 'vesselkeeper';
/** Where the website serves the feed. Each app's electron-builder `publish.url` points under it too. */
export declare const UPDATE_FEED_BASE = "https://marinersentinel.com/updates";
/** The feed directory for one app, with a trailing slash: `${base}/${app}/`. */
export declare function updateFeedUrl(app: FleetApp, base?: string): string;
/**
 * Semver ordering: -1, 0 or 1. A leading `v` is ignored, build metadata is
 * ignored, and a prerelease sorts below its release (`2.12.0-beta.1 < 2.12.0`).
 */
export declare function compareVersions(a: string, b: string): number;
export type AppVersionResult = {
    ok: true;
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    changelog: string;
} | {
    ok: false;
    currentVersion: string;
    error: string;
};
export interface CheckLatestReleaseOptions {
    app: FleetApp;
    currentVersion: string;
    /** Overrides {@link UPDATE_FEED_BASE}; for tests and staging. */
    baseUrl?: string;
    /** Covers the request and reading its body. Default 5000. */
    timeoutMs?: number;
    /** Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
}
/**
 * Ask the feed for the latest release and compare it with the running version.
 *
 * Never throws. A non-OK status (404 included), a network error, a timeout or a
 * body that is not the feed's `release.json` all give `ok: false` with one
 * user-facing message; which of them it was is not something the About panel
 * can act on.
 */
export declare function checkLatestRelease(opts: CheckLatestReleaseOptions): Promise<AppVersionResult>;
/** The part of a response this module writes to; structural so it needs no Express types. */
export interface AppVersionResponse {
    status(n: number): {
        json(b: unknown): void;
    };
}
export interface AppVersionHandlerOptions {
    app: FleetApp;
    getCurrentVersion: () => string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}
/**
 * A request handler for each backend's `/app-version` route.
 *
 * 200 `{ currentVersion, latestVersion, hasUpdate, changelog }` when the feed
 * answers; 502 `{ currentVersion, error }` when it does not. `@sentinel/ui`'s
 * `useAppUpdater` shows the 502 as its error state on a manual check and stays
 * quiet on its mount-time one.
 */
export declare function appVersionHandler(opts: AppVersionHandlerOptions): (req: unknown, res: AppVersionResponse) => Promise<void>;
