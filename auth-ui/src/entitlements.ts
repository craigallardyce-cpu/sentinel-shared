import type { SupabaseClientLike } from './AuthScreen';
import type { StorageLike } from './storage';

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
  'remote_backend',
  'cloud_sync',
  // Ocean Sentinel (shared keys above reused where the name matches)
  'chart_plotter',
  'ships_log',
  'ais_tracking_cpa',
  'vhf_transcription',
  'transcription_extraction',
  'important_alerts',
  'automated_log',
  'weather_routing',
  // Vessel Sentinel
  'maintenance_log',
  'punch_list',
  'inventory',
  'ships_documentation',
  'vessel_specifications',
  'ai_assistant'
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** One product the account holds a tier for, for display only. */
export interface AccountProduct {
  productId: string;
  /** The catalog's display name for the product, '' if the catalog did not give one. */
  productName: string;
  tierNames: string[];
}

/**
 * The account's whole subscription shape, across every product — what a plan
 * pill needs to say "Premium Suite" rather than "Premium", and to tell a
 * customer who holds Ocean but not this product what they do have.
 */
export interface AccountEntitlements {
  /** Bundle tier names held, e.g. ["Premium Suite"]. Empty when à la carte. */
  bundleNames: string[];
  /** Every product the account holds a tier for, this one included. */
  products: AccountProduct[];
}

export interface Entitlements {
  /** feature_key strings granted by every active tier the user holds for this product. */
  features: string[];
  /** Names of the granting tiers, e.g. ["Premium"] — for display, never for gating. */
  tierNames: string[];
  /** Epoch ms of the last successful online refresh. */
  fetchedAt: number;
  /** Strongest status among this product's grants: 'active' if any grant is active, else 'trialing'. */
  status?: 'active' | 'trialing';
  /** Epoch ms when this product's access ends. Null/undefined = open-ended. When trialing, the soonest end among the trialing grants. */
  currentPeriodEnd?: number | null;
  /** The account's whole subscription shape, across every product. */
  account?: AccountEntitlements;
}

const cacheKey = (accessStorageKey: string) => `${accessStorageKey}_entitlements`;

/**
 * Read back a cached account picture, dropping anything of the wrong shape
 * rather than throwing. A cache written before this field existed simply has
 * none, which is why `account` is optional: an existing v1 cache must keep
 * parsing and yield `undefined` until the next online refresh.
 */
function readAccount(raw: any): AccountEntitlements | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const bundleNames = Array.isArray(raw.bundleNames)
    ? raw.bundleNames.filter((n: unknown) => typeof n === 'string')
    : [];
  const products = Array.isArray(raw.products)
    ? raw.products
        .filter((p: any) => p && typeof p === 'object' && typeof p.productId === 'string')
        .map((p: any) => ({
          productId: p.productId as string,
          productName: typeof p.productName === 'string' ? p.productName : '',
          tierNames: Array.isArray(p.tierNames)
            ? p.tierNames.filter((t: unknown) => typeof t === 'string')
            : []
        }))
    : [];
  return { bundleNames, products };
}

export function readEntitlements(storage: StorageLike, accessStorageKey: string): Entitlements | null {
  try {
    const raw = storage.getItem(cacheKey(accessStorageKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.features) || !Array.isArray(parsed?.tierNames)) return null;
    const entitlements: Entitlements = {
      features: parsed.features.filter((f: unknown) => typeof f === 'string'),
      tierNames: parsed.tierNames.filter((t: unknown) => typeof t === 'string'),
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0
    };
    // The display fields are additive: a wrong type is dropped, never thrown,
    // so a corrupt one costs a plan label and never a session.
    if (parsed.status === 'active' || parsed.status === 'trialing') entitlements.status = parsed.status;
    if (parsed.currentPeriodEnd === null) entitlements.currentPeriodEnd = null;
    else if (typeof parsed.currentPeriodEnd === 'number' && Number.isFinite(parsed.currentPeriodEnd)) {
      entitlements.currentPeriodEnd = parsed.currentPeriodEnd;
    }
    const account = readAccount(parsed.account);
    if (account) entitlements.account = account;
    return entitlements;
  } catch {
    return null;
  }
}

export function writeEntitlements(storage: StorageLike, accessStorageKey: string, entitlements: Entitlements): void {
  try {
    storage.setItem(cacheKey(accessStorageKey), JSON.stringify(entitlements));
  } catch {
    // Storage unavailable or full; the cache is an optimisation. hasFeature
    // fails open without it, which is the documented offline stance.
  }
}

export function clearEntitlements(storage: StorageLike, accessStorageKey: string): void {
  try {
    storage.removeItem(cacheKey(accessStorageKey));
  } catch {
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
export function hasFeature(storage: StorageLike, accessStorageKey: string, featureKey: FeatureKey | string): boolean {
  const entitlements = readEntitlements(storage, accessStorageKey);
  if (!entitlements) return true;
  return entitlements.features.includes(featureKey);
}

/**
 * A `current_period_end` as epoch ms, or null when the grant is open-ended (or
 * the value is not a date we can read). Parsed from the row, never compared
 * against the device clock: the views have already applied the database's own
 * clock to decide the grant is still live, and a device with its clock wound
 * back must not be able to extend a trial.
 */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
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
 * The views are `SELECT *` over their tables (website migration 036), so the
 * rows already carry `status` and `current_period_end`, and they already cover
 * every product the account holds. The selects below reach for those columns
 * and for the product's display name; nothing extra is queried, so the plan
 * label and the trial countdown cost no round trip beyond the gating fetch.
 *
 * Throws when the lookup cannot be completed (offline, permissions), so the
 * caller can keep the previous cache rather than overwrite it with less.
 */
export async function fetchEntitlements(
  supabase: SupabaseClientLike,
  userId: string,
  productId: string
): Promise<Entitlements> {
  const tierIds: string[] = [];
  const tierNames: string[] = [];

  // The account picture, built from the same rows without filtering by product.
  const accountProducts = new Map<string, AccountProduct>();
  const bundleNames: string[] = [];

  // This product's grants, for the plan label and the trial countdown. A grant
  // is one row of active_user_subscriptions or active_user_bundles; a bundle
  // row's status and period cover every tier that bundle reaches.
  let hasActiveGrant = false;
  let hasTrialingGrant = false;
  let soonestPeriodEnd: number | null = null;

  const recordAccountTier = (tier: any) => {
    const pid = tier?.product_id;
    if (typeof pid !== 'string') return;
    const productName = typeof tier?.products?.name === 'string' ? tier.products.name : '';
    let entry = accountProducts.get(pid);
    if (!entry) {
      entry = { productId: pid, productName, tierNames: [] };
      accountProducts.set(pid, entry);
    } else if (!entry.productName && productName) {
      entry.productName = productName;
    }
    if (typeof tier?.name === 'string' && !entry.tierNames.includes(tier.name)) entry.tierNames.push(tier.name);
  };

  /** Records the tier, and answers whether it is one of this product's. */
  const addTier = (tier: any): boolean => {
    recordAccountTier(tier);
    if (tier?.product_id !== productId || typeof tier?.id !== 'string') return false;
    if (!tierIds.includes(tier.id)) {
      tierIds.push(tier.id);
      if (typeof tier.name === 'string') tierNames.push(tier.name);
    }
    return true;
  };

  const recordGrant = (row: any) => {
    if (row?.status === 'active') hasActiveGrant = true;
    else if (row?.status === 'trialing') hasTrialingGrant = true;
    const end = toEpochMs(row?.current_period_end);
    if (end !== null && (soonestPeriodEnd === null || end < soonestPeriodEnd)) soonestPeriodEnd = end;
  };

  // Directly held tiers.
  const { data: subs, error: subsError } = await supabase
    .from('active_user_subscriptions')
    .select('status, current_period_end, tiers(id, name, product_id, products(name))')
    .eq('user_id', userId);
  if (subsError) throw subsError;
  (subs ?? []).forEach((s: any) => {
    if (addTier(s?.tiers)) recordGrant(s);
  });

  // Tiers reached through an active bundle.
  const { data: bundles, error: bundlesError } = await supabase
    .from('active_user_bundles')
    .select('bundle_tier_id, status, current_period_end')
    .eq('user_id', userId);
  if (bundlesError) throw bundlesError;

  const bundleRows = (bundles ?? []).filter((b: any) => typeof b?.bundle_tier_id === 'string');
  const bundleTierIds: string[] = [];
  for (const b of bundleRows) {
    if (!bundleTierIds.includes(b.bundle_tier_id)) bundleTierIds.push(b.bundle_tier_id);
  }
  if (bundleTierIds.length > 0) {
    const { data: mappings, error: mappingsError } = await supabase
      .from('bundle_tier_mappings')
      .select('bundle_tier_id, bundle_tiers(name), tiers!inner(id, name, product_id, products(name))')
      .in('bundle_tier_id', bundleTierIds);
    if (mappingsError) throw mappingsError;

    // Which of the held bundles actually reach this product: only those bundles'
    // status and period say anything about this product's access.
    const grantingBundleTierIds: string[] = [];
    (mappings ?? []).forEach((m: any) => {
      const bundleName = m?.bundle_tiers?.name;
      if (typeof bundleName === 'string' && !bundleNames.includes(bundleName)) bundleNames.push(bundleName);
      const grantsThisProduct = addTier(m?.tiers);
      if (grantsThisProduct && typeof m?.bundle_tier_id === 'string' && !grantingBundleTierIds.includes(m.bundle_tier_id)) {
        grantingBundleTierIds.push(m.bundle_tier_id);
      }
    });
    bundleRows.forEach((b: any) => {
      if (grantingBundleTierIds.includes(b.bundle_tier_id)) recordGrant(b);
    });
  }

  const account: AccountEntitlements = { bundleNames, products: [...accountProducts.values()] };

  // No tier for this product: an empty grant, distinct from "could not check".
  // It still carries the account picture, so an app can say "you have Ocean,
  // not this one" rather than nothing at all.
  if (tierIds.length === 0) {
    return { features: [], tierNames: [], fetchedAt: Date.now(), account };
  }

  const { data: tierFeatures, error: featuresError } = await supabase
    .from('tier_features')
    .select('features(feature_key)')
    .in('tier_id', tierIds);
  if (featuresError) throw featuresError;

  const features: string[] = [];
  for (const tf of tierFeatures ?? []) {
    const key = (tf as any)?.features?.feature_key;
    if (typeof key === 'string' && !features.includes(key)) features.push(key);
  }

  const entitlements: Entitlements = { features, tierNames, fetchedAt: Date.now(), account };
  if (hasActiveGrant) entitlements.status = 'active';
  else if (hasTrialingGrant) entitlements.status = 'trialing';
  // There is a grant, so an absent end date means open-ended rather than unknown.
  entitlements.currentPeriodEnd = soonestPeriodEnd;
  return entitlements;
}

/**
 * Fetch and cache in one step, tolerating failure: on success the cache is
 * replaced; on failure the previous cache is left standing and `false` is
 * returned so the caller may log it. Meant for AuthScreen's online
 * verification path, where a failed refresh must not take working features
 * away from a device that is otherwise verified.
 */
export async function refreshEntitlements(
  storage: StorageLike,
  supabase: SupabaseClientLike,
  userId: string,
  productId: string,
  accessStorageKey: string
): Promise<boolean> {
  try {
    const entitlements = await fetchEntitlements(supabase, userId, productId);
    writeEntitlements(storage, accessStorageKey, entitlements);
    return true;
  } catch {
    return false;
  }
}
