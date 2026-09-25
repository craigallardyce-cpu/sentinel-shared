/**
 * The MarinerSentinel user guide, opened from inside an app at the section that
 * app (or the screen it is on) is about.
 *
 * There is one guide and it lives on the website. Its source is
 * `docs-kb/mariner-sentinel-user-guide.html`, served byte-for-byte as
 * `public/user-guide.html` by the website. The apps link to it; they never
 * bundle a copy, because a second copy is a second thing to keep up to date and
 * an installed app would carry a stale one until its next release.
 *
 * The anchors below are the guide's own `id`s, and they are a contract: the
 * website's `check:guide-anchors` imports this file's built output
 * (`dist/userGuideSections.js`, kept free of imports so plain Node can load it) and fails
 * when one of them is missing from the guide it serves, so renaming a heading's
 * `id` in docs-kb breaks the website build rather than silently landing every
 * in-app link at the top of the page.
 */
export declare const USER_GUIDE_URL = "https://marinersentinel.com/user-guide.html";
/** Every guide section an app may link to, in the guide's own order. */
export declare const USER_GUIDE_ANCHORS: readonly ["fleet", "account", "plans", "instruments", "server", "sync", "vessel", "display", "weather", "harbor", "hs-anchor", "hs-alarms", "hs-instr", "hs-ais", "hs-wx", "hs-telegram", "hs-night", "ocean", "os-chart", "os-routes", "os-alarms", "os-ais", "os-plan", "os-filed", "os-forecast", "os-vhf", "os-log", "keeper", "vk-maint", "vk-punch", "vk-inv", "vk-docs", "vk-sync", "vpn", "vpn-aboard", "vpn-phone", "vpn-apps", "vpn-trouble", "help"];
export type UserGuideSection = (typeof USER_GUIDE_ANCHORS)[number];
/** Each app's own chapter: where its general "User guide" link lands. */
export declare const USER_GUIDE_APP_SECTION: {
    readonly harborsentinel: "harbor";
    readonly oceansentinel: "ocean";
    readonly vesselkeeper: "keeper";
};
export type UserGuideApp = keyof typeof USER_GUIDE_APP_SECTION;
/**
 * The guide's address, at `section` when one is given. An unknown section is
 * dropped rather than passed through, so a stale call opens the top of the
 * guide instead of a URL whose fragment matches nothing.
 */
export declare function userGuideUrl(section?: UserGuideSection | null): string;
