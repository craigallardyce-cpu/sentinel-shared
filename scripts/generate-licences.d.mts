// Types for the Vite configs that import the licence plugin (TypeScript configs
// in HarborSentinel and VesselKeeper). See generate-licences.mjs.
export interface LicencesPluginOptions {
  /** Folders whose package-lock.json names what the app loads outside the web bundle. */
  roots?: string[];
  /** The asset written beside index.html. Default "third-party-licenses.json". */
  fileName?: string;
}
// Returned as a Vite plugin; typed loosely so this repo needs no Vite types.
export declare function licencesPlugin(options?: LicencesPluginOptions): any;
