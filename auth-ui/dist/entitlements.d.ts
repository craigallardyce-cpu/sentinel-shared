import type { SupabaseClientLike } from './AuthScreen';
/**
 * Tier entitlements: which catalog features this user's subscription grants.
 *
 * The catalog's `tier_features` table (managed in the admin app, reconciled by
 * the website's migration 016) maps every tier to feature keys. The tier line
 * it encodes: Basic is a self-contained app on one device using its own GPS;
 * Premium connects to the vessel — NMEA instruments, AIS, the AI features, and
 * cloud sync. Apps gate their premium surfaces on these keys instead of
 * hard-coding what a plan means.
 *
 * Offline stance, same as the rest of AuthScreen: this is a licensing
 * decision, not a security boundary. Entitlements are fetched during online
 * verification and cached in localStorage next to the access flag; offline
 * launches read the cache. A device with no cache at all (an app version from
 * before entitlements existed, or the explicit local-only offline mode, which
 * already bypasses licensing entirely) fails OPEN — a Premium crew mid-passage
 * must never lose their instruments to a missing cache. The cache is refreshed
 * on every successful online verification and cleared on sign-out.
 */
/**
 * The feature keys the catalog defines today, for editor help and to keep app
 * code honest — `hasFeature` accepts any string so a new catalog key does not
 * need a shared-package release before an app can gate on it.
 */
export declare const FEATURE_KEYS: readonly ["anchor_alarm", "telegram_alerts", "weather_alerts", "tidal_info", "offline_operation", "n2k_stream", "instrument_alerts", "ais_tracking", "vpn_remote", "cloud_sync", "chart_plotter", "ships_log", "ais_tracking_cpa", "vhf_transcription", "transcription_extraction", "important_alerts", "automated_log", "maintenance_log", "punch_list", "inventory", "ships_documentation", "vessel_specifications", "ai_assistant"];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export interface Entitlements {
    /** feature_key strings granted by every active tier the user holds for this product. */
    features: string[];
    /** Names of the granting tiers, e.g. ["Premium"] — for display, never for gating. */
    tierNames: string[];
    /** Epoch ms of the last successful online refresh. */
    fetchedAt: number;
}
export declare function readEntitlements(accessStorageKey: string): Entitlements | null;
export declare function writeEntitlements(accessStorageKey: string, entitlements: Entitlements): void;
export declare function clearEntitlements(accessStorageKey: string): void;
/**
 * Whether the cached entitlements grant a feature.
 *
 * Fails open when there is no cache: a device that verified before this
 * package existed, or the explicit local-only offline mode (which bypasses
 * licensing entirely today), keeps full functionality. Once a cache exists it
 * answers from the cache alone — call sites stay synchronous and render-safe.
 */
export declare function hasFeature(accessStorageKey: string, featureKey: FeatureKey | string): boolean;
/**
 * Resolve the user's entitlements for one product from the live catalog:
 * every active tier they hold for it — directly subscribed or through a
 * bundle — unioned over tier_features.
 *
 * Reads the `active_user_*` views rather than the tables behind them. Those
 * views apply both halves of "still entitled" — a status of active or
 * trialing, and a `current_period_end` that has not passed — using the
 * database's own clock, so a device with its clock wound back cannot extend a
 * trial, and an expired one needs no job to revoke it: it simply stops being
 * returned. The views are security_invoker, so the caller's RLS still confines
 * them to their own rows.
 *
 * Throws when the lookup cannot be completed (offline, permissions), so the
 * caller can keep the previous cache rather than overwrite it with less.
 */
export declare function fetchEntitlements(supabase: SupabaseClientLike, userId: string, productId: string): Promise<Entitlements>;
/**
 * Fetch and cache in one step, tolerating failure: on success the cache is
 * replaced; on failure the previous cache is left standing and `false` is
 * returned so the caller may log it. Meant for AuthScreen's online
 * verification path, where a failed refresh must not take working features
 * away from a device that is otherwise verified.
 */
export declare function refreshEntitlements(supabase: SupabaseClientLike, userId: string, productId: string, accessStorageKey: string): Promise<boolean>;
