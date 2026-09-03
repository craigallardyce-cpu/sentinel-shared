import { describe, it, expect, afterEach } from 'vitest';
import {
  hasFeature,
  readEntitlements,
  writeEntitlements,
  clearEntitlements,
  fetchEntitlements,
  refreshEntitlements
} from '../src/entitlements';
import { memoryStorage } from './memoryStorage';

// The store under test, not the browser global: every one of these functions
// takes it as its first argument, and passing the key string there instead is
// what silently broke this suite.
const storage = memoryStorage();

afterEach(() => {
  storage.clear();
});

const KEY = 'testapp_access';

/** Where readEntitlements looks, so the corrupt-cache cases can plant a value. */
const CACHE_KEY = `${KEY}_entitlements`;

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
  it('round-trips through the store it was handed', () => {
    writeEntitlements(storage, KEY, { features: ['n2k_stream'], tierNames: ['Premium'], fetchedAt: 123 });
    expect(readEntitlements(storage, KEY)).toEqual({
      features: ['n2k_stream'],
      tierNames: ['Premium'],
      fetchedAt: 123
    });
    clearEntitlements(storage, KEY);
    expect(readEntitlements(storage, KEY)).toBeNull();
  });

  it('treats corrupt or wrong-shaped cache entries as absent', () => {
    storage.setItem(CACHE_KEY, 'not json');
    expect(readEntitlements(storage, KEY)).toBeNull();
    storage.setItem(CACHE_KEY, JSON.stringify({ features: 'nope' }));
    expect(readEntitlements(storage, KEY)).toBeNull();
    storage.setItem(CACHE_KEY, JSON.stringify({ features: [], tierNames: 'nope' }));
    expect(readEntitlements(storage, KEY)).toBeNull();
  });
});

describe('hasFeature', () => {
  it('fails open when no cache exists', () => {
    expect(readEntitlements(storage, KEY)).toBeNull();
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(true);
    expect(hasFeature(storage, KEY, 'anything_at_all')).toBe(true);
  });

  // A store that throws on every access is the same situation as an empty one:
  // nothing is known, so nothing may be taken away. This is the case that used
  // to be tested by accident, when the key string stood in for the store.
  it('fails open when the store itself is unusable', () => {
    const broken = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      }
    };
    expect(hasFeature(broken, KEY, 'n2k_stream')).toBe(true);
    // Writing through it must not throw either -- the cache is an optimisation.
    expect(() =>
      writeEntitlements(broken, KEY, { features: [], tierNames: [], fetchedAt: 0 })
    ).not.toThrow();
    expect(() => clearEntitlements(broken, KEY)).not.toThrow();
  });

  it('answers from the cache once one exists', () => {
    writeEntitlements(storage, KEY, {
      features: ['anchor_alarm', 'weather_alerts'],
      tierNames: ['Basic'],
      fetchedAt: Date.now()
    });
    expect(hasFeature(storage, KEY, 'anchor_alarm')).toBe(true);
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(false);
    expect(hasFeature(storage, KEY, 'ai_assistant')).toBe(false);
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

    expect(await refreshEntitlements(storage, supabase, 'user-1', PRODUCT, KEY)).toBe(true);
    expect(readEntitlements(storage, KEY)?.features).toEqual(['anchor_alarm']);
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(false);
  });

  it('leaves the previous cache standing on failure', async () => {
    writeEntitlements(storage, KEY, { features: ['n2k_stream'], tierNames: ['Premium'], fetchedAt: 1 });
    const supabase = makeMockSupabase({
      active_user_subscriptions: { data: null, error: new Error('offline') }
    });

    expect(await refreshEntitlements(storage, supabase, 'user-1', PRODUCT, KEY)).toBe(false);
    expect(readEntitlements(storage, KEY)?.features).toEqual(['n2k_stream']);
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(true);
  });
});
