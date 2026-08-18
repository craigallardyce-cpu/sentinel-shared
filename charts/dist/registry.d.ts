/**
 * Chart provider registry, shared across the Mariner Sentinel fleet.
 *
 * Single source of truth for every map layer any of the apps can display. Tile proxies,
 * layer pickers and coverage-aware auto-select all read from here rather than branching on
 * hardcoded provider names. Adding a provider — including a future commercial one — should
 * mean adding an entry here and nothing else.
 *
 * BASEMAP LICENSING
 * Supplying a MapTiler key activates the licensed basemaps and withdraws the unlicensed
 * `osm` and `satellite` entries, so a configured host cannot serve tiles it has no right to.
 * Without a key those two remain so the map still renders in development, but they must not
 * reach production: OpenStreetMap's tile policy forbids the caching proxies these apps keep,
 * and Esri World Imagery requires a licence for commercial use.
 *
 * The MapTiler Free plan is additionally non-commercial and requires the MapTiler logo to be
 * displayed; a paid plan needs only the "© MapTiler" credit carried in the attribution below.
 */
import type { ChartRegistry, RegistryOptions, TileOptions } from './types.js';
/** Web Mercator bbox for an XYZ tile, as the Esri MapServer export endpoints expect. */
export declare function tileBboxMeters(z: number, x: number, y: number): string;
/**
 * NOAA and CHS both run Esri's Maritime Chart Service extension with identical S-52 layer
 * numbering and the same ECDIS display_params contract, so one builder serves both.
 */
export declare function maritimeChartService(baseUrl: string): (z: number, x: number, y: number, opts?: TileOptions) => string;
/**
 * Builds a registry for one host.
 *
 * Configuration is passed in rather than read from the environment so the same module serves
 * an Electron backend, a hosted proxy and a marketing site without any of them having to
 * agree on variable names.
 */
export declare function createChartRegistry(options?: RegistryOptions): ChartRegistry;
