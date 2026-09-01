/**
 * The registry: the set of settings that exist, and the checks that a
 * declaration is coherent before anything tries to use it.
 *
 * Every check here fails at construction — which means at import, which means at
 * the app's first render and in CI, rather than on a boat. That placement is the
 * whole value of the file. A default that does not satisfy its own type is
 * exactly the class of mistake that shipped a home LAN address as
 * OceanSentinel's NMEA gateway default, and it is caught here in one line.
 */
import type { PlatformContext, SettingDefinition, SettingSpec } from './types.js';
/** Authoring helper. Identity at runtime; it exists to anchor type inference and JSDoc. */
export declare function defineSetting<T>(spec: SettingSpec<T>): SettingSpec<T>;
/**
 * Resolve a declared default for a platform, or `undefined` when the setting
 * declares none — which is almost all of them. See `SettingSpec.default`.
 */
export declare function defaultFor<T>(spec: SettingSpec<T>, platform: PlatformContext): T | undefined;
export type AnySpec = SettingSpec<any>;
export type AnyDefinition = SettingDefinition<any>;
export interface Registry<D extends Record<string, AnySpec>> {
    /** The specs as authored, for typed lookups by key literal. */
    readonly specs: D;
    has(key: string): boolean;
    /** Throws for an unknown key: a typo in a settings key should not read as "unset". */
    get(key: string): AnyDefinition;
    keys(): string[];
    all(): AnyDefinition[];
}
export declare function createRegistry<D extends Record<string, AnySpec>>(specs: D): Registry<D>;
