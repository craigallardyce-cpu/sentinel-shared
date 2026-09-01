/**
 * The resolution chain.
 *
 * Reading a setting walks the layers from broadest to narrowest and keeps the
 * last one that answered with something it could parse. Writing names a layer
 * explicitly and is refused if the setting does not declare it.
 *
 * The asymmetry between the two is deliberate and worth stating, because it is
 * the property the rest of the design rests on:
 *
 *   Reads are lenient.  A layer holding a value this build cannot understand is
 *                       skipped, not fatal. Something always resolves, and the
 *                       floor is the declared default.
 *   Writes are strict.  A value that does not parse, or a scope the setting does
 *                       not declare, throws. Nothing gets into a store that a
 *                       later read would have to skip.
 *
 * And the shape that cannot exist here: there is no way to write "all the
 * settings" at once. `set` takes one key. HarborSentinel's `POST /config` built
 * one UPDATE from the whole request body, so every field a caller omitted was
 * written as null — it reset the NMEA gateway, nulled own MMSI and switched the
 * AIS proximity alarm off, with no error, because from the database's point of
 * view the write succeeded. That bug is not fixed here so much as made
 * unspellable.
 */
import type { AnySpec, Registry } from './registry.js';
import type { PlatformContext, Scope, ScopeStore, SettingValue, Source } from './types.js';
export interface SettingsStoreOptions<D extends Record<string, AnySpec>> {
    registry: Registry<D>;
    /** One store per layer. Layers with no store simply never answer. */
    stores: readonly ScopeStore[];
    /** Defaults to desktop. Pass `{ native: Capacitor.isNativePlatform() }`. */
    platform?: PlatformContext;
}
export interface Resolved<T> {
    value: T;
    /** Which layer answered. `default` means none did. */
    source: Source;
}
export interface SettingsStore<D extends Record<string, AnySpec>> {
    /** The resolved value. Never throws for a declared key; always returns something. */
    get<K extends keyof D & string>(key: K): SettingValue<D[K]>;
    /** The resolved value plus where it came from, for "set on this device / from the boat". */
    resolve<K extends keyof D & string>(key: K): Resolved<SettingValue<D[K]>>;
    source(key: string): Source;
    /** True when this layer holds a usable value — i.e. there is an override to clear. */
    isSetAt(key: string, scope: Scope): boolean;
    /** The scopes this setting may be written to, narrowest last. */
    scopesFor(key: string): readonly Scope[];
    set<K extends keyof D & string>(key: K, value: SettingValue<D[K]>, options: {
        scope: Scope;
    }): Promise<void>;
    clear(key: string, scope: Scope): Promise<void>;
    /** Fires when any attached layer changes. Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** Every declared setting, resolved. For diagnostics and support bundles. */
    snapshot(): Record<string, unknown>;
}
export declare function createSettingsStore<D extends Record<string, AnySpec>>(options: SettingsStoreOptions<D>): SettingsStore<D>;
