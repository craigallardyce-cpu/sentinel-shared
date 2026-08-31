import { describe, it, expect, afterEach } from 'vitest';
import {
  hasFeature,
  readEntitlements,
  writeEntitlements,
  clearEntitlements,
  fetchEntitlements,
  refreshEntitlements
} from '../src/entitlements';

afterEach(() => {
  localStorage.clear();
});

const KEY = 'testapp_access';

// A chainable stand-in for Supabase's PostgrestFilterBuilder, resolving to a
// per-table result: every filter method returns itself and the object is
// thenable so `await` resolves to the configured { data, error }.
function makeMockSupabase(results: Record<string, { data: any; error: any }>) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: [], error: null };
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
      };
      return builder;
    }
  } as any;
}

const PRODUCT = 'product-1';

describe('entitlements cache', () => {
  it('round-trips through localStorage', () => {
    writeEntitlements(KEY, { features: ['n2k_stream'], tierNames: ['Premium'], fetchedAt: 123 });
    expect(readEntitlements(KEY)).toEqual({
      features: ['n2k_stream'],
      tierNames: ['Premium'],
      fetchedAt: 123
    });
    clearEntitlements(KEY);
    expect(readEntitlements(KEY)).toBeNull();
  });

  it('treats corrupt or wrong-shaped cache entries as absent', () => {
    localStorage.setItem(`${KEY}_entitlements`, 'not json');
    expect(readEntitlements(KEY)).toBeNull();
    localStorage.setItem(`${KEY}_entitlements`, JSON.stringify({ features: 'nope' }));
    expect(readEntitlements(KEY)).toBeNull();
  });
});

describe('hasFeature', () => {
  it('fails open when no cache exists', () => {
    expect(hasFeature(KEY, 'n2k_stream')).toBe(true);
  });

  it('answers from the cache once one exists', () => {
    writeEntitlements(KEY, {
      features: ['anchor_alarm', 'weather_alerts'],
      tierNames: ['Basic'],
      fetchedAt: Date.now()
    });
    expect(hasFeature(KEY, 'anchor_alarm')).toBe(true);
    expect(hasFeature(KEY, 'n2k_stream')).toBe(false);
    expect(hasFeature(KEY, 'ai_assistant')).toBe(false);
  });
});

describe('fetchEntitlements', () => {
  it('resolves features for a directly held tier of this product', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [
          { tiers: { id: 'tier-basic', name: 'Basic', product_id: PRODUCT } },
          { tiers: { id: 'tier-other', name: 'Premium', product_id: 'other-product' } }
        ],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: {
        data: [
          { features: { feature_key: 'anchor_alarm' } },
          { features: { feature_key: 'weather_alerts' } }
        ],
        error: null
      }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.features.sort()).toEqual(['anchor_alarm', 'weather_alerts']);
    expect(ent.tierNames).toEqual(['Basic']);
    expect(ent.fetchedAt).toBeGreaterThan(0);
  });

  it('resolves tiers reached through an active bundle', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: { data: [], error: null },
      active_user_bundles: { data: [{ bundle_tier_id: 'suite-premium' }], error: null },
      bundle_tier_mappings: {
        data: [
          { tiers: { id: 'tier-premium', name: 'Premium', product_id: PRODUCT } },
          { tiers: { id: 'tier-elsewhere', name: 'Premium', product_id: 'other-product' } }
        ],
        error: null
      },
      tier_features: {
        data: [{ features: { feature_key: 'n2k_stream' } }],
        error: null
      }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.features).toEqual(['n2k_stream']);
    expect(ent.tierNames).toEqual(['Premium']);
  });

  // The expiry half of "still entitled" is applied by the active_user_* views,
  // on the database's clock, so a lapsed trial stops being returned without any
  // status flip to schedule. That only holds while this reads the views: pointed
  // back at the base tables it would hand a 30-day trial permanent access, which
  // is precisely the bug the views exist to prevent.
  it('reads the entitlement views, not the tables behind them', async () => {
    const supabase = makeMockSupabase({
      user_subscriptions: {
        data: [{ tiers: { id: 'tier-basic', name: 'Basic', product_id: PRODUCT } }],
        error: null
      },
      user_bundles: { data: [{ bundle_tier_id: 'suite-premium' }], error: null },
      tier_features: { data: [{ features: { feature_key: 'anchor_alarm' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.features).toEqual([]);
    expect(ent.tierNames).toEqual([]);
  });

  it('returns an empty grant when the user holds no tier for this product', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: { data: [], error: null },
      active_user_bundles: { data: [], error: null }
    });
    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.features).toEqual([]);
    expect(ent.tierNames).toEqual([]);
  });

  it('dedupes features granted by more than one tier', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [
          { tiers: { id: 'tier-a', name: 'Basic', product_id: PRODUCT } },
          { tiers: { id: 'tier-b', name: 'Premium', product_id: PRODUCT } }
        ],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: {
        data: [
          { features: { feature_key: 'anchor_alarm' } },
          { features: { feature_key: 'anchor_alarm' } },
          { features: { feature_key: 'n2k_stream' } }
        ],
        error: null
      }
    });
    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.features.sort()).toEqual(['anchor_alarm', 'n2k_stream']);
  });

  it('throws when a lookup fails, so callers keep their previous cache', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: { data: null, error: new Error('offline') }
    });
    await expect(fetchEntitlements(supabase, 'user-1', PRODUCT)).rejects.toThrow('offline');
  });
});

describe('refreshEntitlements', () => {
  it('writes the cache on success', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [{ tiers: { id: 'tier-basic', name: 'Basic', product_id: PRODUCT } }],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: { data: [{ features: { feature_key: 'anchor_alarm' } }], error: null }
    });

    expect(await refreshEntitlements(supabase, 'user-1', PRODUCT, KEY)).toBe(true);
    expect(readEntitlements(KEY)?.features).toEqual(['anchor_alarm']);
    expect(hasFeature(KEY, 'n2k_stream')).toBe(false);
  });

  it('leaves the previous cache standing on failure', async () => {
    writeEntitlements(KEY, { features: ['n2k_stream'], tierNames: ['Premium'], fetchedAt: 1 });
    const supabase = makeMockSupabase({
      active_user_subscriptions: { data: null, error: new Error('offline') }
    });

    expect(await refreshEntitlements(supabase, 'user-1', PRODUCT, KEY)).toBe(false);
    expect(readEntitlements(KEY)?.features).toEqual(['n2k_stream']);
    expect(hasFeature(KEY, 'n2k_stream')).toBe(true);
  });
});
