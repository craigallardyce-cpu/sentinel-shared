/**
 * The device layer, backed by `localStorage`.
 *
 * Two things here are not obvious and both exist because of how the fleet's
 * settings got into their current state.
 *
 * **Everything is namespaced.** Values are written under `sentinel.<key>`, so
 * settings stop sharing a flat namespace with cached application data. Today
 * OceanSentinel's 68 `localStorage` keys mix preferences (`vhf_squelch_threshold`)
 * with cached records (`vessel_passages`, `vessel_logs`) and credentials
 * (`oauth_provider_token`), and nothing in the name distinguishes them — which is
 * most of why "68 settings" sounded like a bigger job than it is.
 *
 * **Legacy keys are read but never written.** A setting can declare where it
 * used to live per app, and this store falls back to those names when the
 * namespaced key is absent. That makes adopting the registry non-destructive by
 * construction: a device that upgrades keeps every value somebody had set,
 * without a migration having to run first and without this store quietly
 * rewriting a person's storage on a read.
 */
import type { Registry, AnySpec } from './registry.js';
import type { AppName, ScopeStore } from './types.js';
/**
 * The two methods this package needs from a `Storage`. Injected rather than
 * reached for, because the package compiles with no DOM types — and because
 * tests, Electron's main process and a future native store all supply their own.
 */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export interface DeviceStoreOptions {
    /** Which app's legacy key names to consult. */
    app: AppName;
    registry: Registry<Record<string, AnySpec>> | Registry<any>;
    /** Override only if a host genuinely shares one Storage between two apps. */
    prefix?: string;
}
export declare const DEFAULT_PREFIX = "sentinel.";
export interface DeviceStore extends ScopeStore {
    /**
     * Call from the host when storage changed underneath us — typically from a
     * `storage` event, which fires when another tab or window writes. The package
     * never touches `window` itself, so wiring that up is the app's job.
     */
    notifyExternalChange(): void;
}
export declare function createDeviceStore(storage: StorageLike, options: DeviceStoreOptions): DeviceStore;
