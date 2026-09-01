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
 * verification and cached beside the access flag; offline
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
export const FEATURE_KEYS = [
    // Harbor Sentinel
    'anchor_alarm',
    'telegram_alerts',
    'weather_alerts',
    'tidal_info',
    'offline_operation',
    'n2k_stream',
    'instrument_alerts',
    'ais_tracking',
    'vpn_remote',
    'cloud_sync',
    // Ocean Sentinel (shared keys above reused where the name matches)
    'chart_plotter',
    'ships_log',
    'ais_tracking_cpa',
    'vhf_transcription',
    'transcription_extraction',
    'important_alerts',
    'automated_log',
    // Vessel Sentinel
    'maintenance_log',
    'punch_list',
    'inventory',
    'ships_documentation',
    'vessel_specifications',
    'ai_assistant'
];
const cacheKey = (accessStorageKey) => `${accessStorageKey}_entitlements`;
export function readEntitlements(storage, accessStorageKey) {
    try {
        const raw = storage.getItem(cacheKey(accessStorageKey));
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.features) || !Array.isArray(parsed?.tierNames))
            return null;
        return {
            features: parsed.features.filter((f) => typeof f === 'string'),
            tierNames: parsed.tierNames.filter((t) => typeof t === 'string'),
            fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0
        };
    }
    catch {
        return null;
    }
}
export function writeEntitlements(storage, accessStorageKey, entitlements) {
    try {
        storage.setItem(cacheKey(accessStorageKey), JSON.stringify(entitlements));
    }
    catch {
        // Storage unavailable or full; the cache is an optimisation. hasFeature
        // fails open without it, which is the documented offline stance.
    }
}
export function clearEntitlements(storage, accessStorageKey) {
    try {
        storage.removeItem(cacheKey(accessStorageKey));
    }
    catch {
        /* ignore */
    }
}
/**
 * Whether the cached entitlements grant a feature.
 *
 * Fails open when there is no cache: a device that verified before this
 * package existed, or the explicit local-only offline mode (which bypasses
 * licensing entirely today), keeps full functionality. Once a cache exists it
 * answers from the cache alone — call sites stay synchronous and render-safe.
 */
export function hasFeature(storage, accessStorageKey, featureKey) {
    const entitlements = readEntitlements(storage, accessStorageKey);
    if (!entitlements)
        return true;
    return entitlements.features.includes(featureKey);
}
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
export async function fetchEntitlements(supabase, userId, productId) {
    const tierIds = [];
    const tierNames = [];
    const addTier = (tier) => {
        if (tier?.product_id !== productId || typeof tier?.id !== 'string')
            return;
        if (!tierIds.includes(tier.id)) {
            tierIds.push(tier.id);
            if (typeof tier.name === 'string')
                tierNames.push(tier.name);
        }
    };
    // Directly held tiers.
    const { data: subs, error: subsError } = await supabase
        .from('active_user_subscriptions')
        .select('tiers(id, name, product_id)')
        .eq('user_id', userId);
    if (subsError)
        throw subsError;
    (subs ?? []).forEach((s) => addTier(s.tiers));
    // Tiers reached through an active bundle.
    const { data: bundles, error: bundlesError } = await supabase
        .from('active_user_bundles')
        .select('bundle_tier_id')
        .eq('user_id', userId);
    if (bundlesError)
        throw bundlesError;
    const bundleTierIds = (bundles ?? []).map((b) => b.bundle_tier_id).filter(Boolean);
    if (bundleTierIds.length > 0) {
        const { data: mappings, error: mappingsError } = await supabase
            .from('bundle_tier_mappings')
            .select('tiers!inner(id, name, product_id)')
            .in('bundle_tier_id', bundleTierIds);
        if (mappingsError)
            throw mappingsError;
        (mappings ?? []).forEach((m) => addTier(m.tiers));
    }
    // No tier for this product: an empty grant, distinct from "could not check".
    if (tierIds.length === 0) {
        return { features: [], tierNames: [], fetchedAt: Date.now() };
    }
    const { data: tierFeatures, error: featuresError } = await supabase
        .from('tier_features')
        .select('features(feature_key)')
        .in('tier_id', tierIds);
    if (featuresError)
        throw featuresError;
    const features = [];
    for (const tf of tierFeatures ?? []) {
        const key = tf?.features?.feature_key;
        if (typeof key === 'string' && !features.includes(key))
            features.push(key);
    }
    return { features, tierNames, fetchedAt: Date.now() };
}
/**
 * Fetch and cache in one step, tolerating failure: on success the cache is
 * replaced; on failure the previous cache is left standing and `false` is
 * returned so the caller may log it. Meant for AuthScreen's online
 * verification path, where a failed refresh must not take working features
 * away from a device that is otherwise verified.
 */
export async function refreshEntitlements(storage, supabase, userId, productId, accessStorageKey) {
    try {
        const entitlements = await fetchEntitlements(supabase, userId, productId);
        writeEntitlements(storage, accessStorageKey, entitlements);
        return true;
    }
    catch {
        return false;
    }
}
