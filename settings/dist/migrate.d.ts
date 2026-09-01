/**
 * Carrying pre-registry values up to the layer they belong to.
 *
 * The device store reads a setting's old `localStorage` key when the namespaced
 * one is absent, which makes adopting the registry free — but only for settings
 * that declare a `device` scope, because a store is never consulted for a scope
 * its setting does not declare. Everything held at `account` or `vessel` has its
 * old value sitting in `localStorage` where nothing will ever read it.
 *
 * That is most of what OceanSentinel keeps: the VHF retention policy, the log
 * book's interval and its field list, the transcription model, the boat's name,
 * MMSI and type. Adopting without this step would resolve all of them to their
 * defaults — which, since almost nothing has one, means losing them.
 *
 * Run once per device, and record that it ran.
 */
import type { AnySpec, Registry } from './registry.js';
import type { StorageLike } from './deviceStore.js';
import type { SettingsStore } from './store.js';
import type { AppName, PlatformContext, Scope } from './types.js';
export interface MigrateLegacyOptions<D extends Record<string, AnySpec>> {
    registry: Registry<D>;
    settings: SettingsStore<D>;
    /** Whose legacy key names to look for. */
    app: AppName;
    /** Where the old flat keys live. */
    storage: StorageLike;
    /** Scopes that actually have a store attached, narrowest last. */
    writableScopes: readonly Scope[];
    platform?: PlatformContext;
    /** Namespace the device store writes under. Must match its store. */
    devicePrefix?: string;
    /** Marks the migration done. Change it only to deliberately re-run. */
    markerKey?: string;
    /** Report progress without writing anything. */
    dryRun?: boolean;
}
export interface MigrateLegacyResult {
    /** Keys carried up, as `key -> scope`. */
    migrated: Record<string, Scope>;
    /** Keys that had a legacy value this build could not parse. */
    unparseable: string[];
    /** True when the marker said this had already run. */
    alreadyDone: boolean;
}
/**
 * Versioned, because what the migration does has changed.
 *
 * v1 skipped device-scoped settings: the device store reads their old key names
 * in place, so copying them looked like making a second copy of a value that was
 * being read fine. That was true right up until the old names are deleted, at
 * which point every one of them -- brightness, keep awake, the backend address,
 * the gateway, the VHF tuning -- would silently revert to its default on every
 * install that had ever set it.
 *
 * Bumping the marker re-runs the whole thing, which is safe: a setting a layer
 * already holds is skipped.
 */
export declare const DEFAULT_MARKER_KEY = "sentinel.migrated.legacy.v2";
/**
 * **Call this only after every cloud layer has finished `load()`.**
 *
 * A setting reads as unconfigured while its layer is still loading, and this
 * function writes into anything unconfigured. Run it too early and it would push
 * a stale local value over whatever the account already holds — turning a
 * migration into the data loss it exists to prevent. The `writableScopes` list
 * is the second half of that guard: a scope with no store attached is not a
 * place to migrate into.
 */
export declare function migrateLegacyKeys<D extends Record<string, AnySpec>>(options: MigrateLegacyOptions<D>): Promise<MigrateLegacyResult>;
