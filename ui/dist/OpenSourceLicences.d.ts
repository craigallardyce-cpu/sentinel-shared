import React from 'react';
/**
 * The file each app's build writes beside its index.html, with every
 * open-source package the app ships and the licence text it came with
 * (`sentinel-shared/scripts/generate-licences.mjs`). Fetched relative to the
 * page, so it resolves the same under Electron's local server, Android's
 * WebView and a browser on the boat's network.
 */
export declare const LICENCES_FILE = "third-party-licenses.json";
/** One package as the generator writes it. */
export interface LicencedPackage {
    name: string;
    version: string;
    /** The SPDX expression from the package's own package.json, or "UNKNOWN". */
    license: string;
    /** Index into `texts`, or -1 when the package ships no licence file. */
    text: number;
}
/** The whole file. Identical licence texts are stored once and shared. */
export interface LicenceFile {
    generatedAt: string;
    packages: LicencedPackage[];
    texts: string[];
}
/** Whether a parsed file has the shape the generator writes. */
export declare function isLicenceFile(value: unknown): value is LicenceFile;
/**
 * "Open-source licences" in the About card: Terms of Service §5 says the apps
 * list their open-source components' licences, and MIT, BSD and Apache
 * require their notices to ship with the software that uses them.
 *
 * Inline rather than its own dialog. About already sits inside the Settings
 * dialog, and the fleet Modal closes on Escape from a document listener, so a
 * second Modal on top of it would close both at once.
 */
export declare function OpenSourceLicences({ appName }: {
    appName: string;
}): React.JSX.Element;
