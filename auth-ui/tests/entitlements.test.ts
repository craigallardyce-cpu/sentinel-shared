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
function makeMockSupabase(
  results: Record<string, { data: any; error: any }>,
  calls: { table: string; select: string }[] = []
) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: [], error: null };
      const builder: any = {
        select: (select: string) => {
          calls.push({ table, select });
          return builder;
        },
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

// --- Plan visibility -------------------------------------------------------
// The apps show which plan the customer is on, and during a trial how much of
// it is left. All of it comes from rows fetchEntitlements already reads: the
// active_user_* views are SELECT * over their tables (website migration 036),
// so status and current_period_end are in the rows, and the rows cover every
// product the account holds — not only the one being asked about.

/** A subscription row as the view returns it, with the display name embedded. */
const sub = (
  tier: { id: string; name: string; product_id: string; product?: string },
  grant: { status?: string; current_period_end?: string | null } = {}
) => ({
  status: grant.status ?? 'active',
  current_period_end: grant.current_period_end === undefined ? null : grant.current_period_end,
  tiers: {
    id: tier.id,
    name: tier.name,
    product_id: tier.product_id,
    products: { name: tier.product ?? 'A Product' }
  }
});

describe('fetchEntitlements: status and period end', () => {
  it('takes the strongest status when grants mix active and trialing', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [
          sub({ id: 'tier-basic', name: 'Basic', product_id: PRODUCT }, { status: 'trialing' }),
          sub({ id: 'tier-premium', name: 'Premium', product_id: PRODUCT }, { status: 'active' })
        ],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: { data: [{ features: { feature_key: 'anchor_alarm' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.status).toBe('active');
  });

  it('reports trialing when every grant for this product is a trial', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [
          sub({ id: 'tier-premium', name: 'Premium', product_id: PRODUCT }, { status: 'trialing' }),
          // An active grant on a different product must not make this one active.
          sub({ id: 'tier-other', name: 'Premium', product_id: 'other-product' }, { status: 'active' })
        ],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: { data: [{ features: { feature_key: 'n2k_stream' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.status).toBe('trialing');
  });

  it('reports the soonest period end among this product grants, from the row values', async () => {
    const soon = '2026-10-01T00:00:00.000Z';
    const later = '2027-03-01T00:00:00.000Z';
    const elsewhere = '2026-01-01T00:00:00.000Z';
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [
          sub({ id: 'tier-premium', name: 'Premium', product_id: PRODUCT }, { status: 'trialing', current_period_end: later }),
          sub({ id: 'tier-basic', name: 'Basic', product_id: PRODUCT }, { status: 'trialing', current_period_end: soon }),
          // Another product's earlier end must not shorten this product's countdown.
          sub({ id: 'tier-other', name: 'Basic', product_id: 'other-product' }, { status: 'trialing', current_period_end: elsewhere })
        ],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: { data: [{ features: { feature_key: 'anchor_alarm' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.currentPeriodEnd).toBe(Date.parse(soon));
    expect(ent.status).toBe('trialing');
  });

  it('reports null for an open-ended grant', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [sub({ id: 'tier-premium', name: 'Premium', product_id: PRODUCT }, { current_period_end: null })],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: { data: [{ features: { feature_key: 'n2k_stream' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.currentPeriodEnd).toBeNull();
    expect(ent.status).toBe('active');
  });

  it('takes status and period end from a bundle that reaches this product', async () => {
    const ends = '2026-09-20T00:00:00.000Z';
    const supabase = makeMockSupabase({
      active_user_subscriptions: { data: [], error: null },
      active_user_bundles: {
        data: [{ bundle_tier_id: 'suite-premium', status: 'trialing', current_period_end: ends }],
        error: null
      },
      bundle_tier_mappings: {
        data: [
          {
            bundle_tier_id: 'suite-premium',
            bundle_tiers: { name: 'Premium Suite' },
            tiers: { id: 'tier-premium', name: 'Premium', product_id: PRODUCT, products: { name: 'Harbor Sentinel' } }
          }
        ],
        error: null
      },
      tier_features: { data: [{ features: { feature_key: 'n2k_stream' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.status).toBe('trialing');
    expect(ent.currentPeriodEnd).toBe(Date.parse(ends));
    expect(ent.account?.bundleNames).toEqual(['Premium Suite']);
  });

  // A bundle the account holds for other products says nothing about this one:
  // its trial ending next week must not appear as this product's countdown.
  it('ignores a held bundle that does not reach this product', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [sub({ id: 'tier-premium', name: 'Premium', product_id: PRODUCT }, { status: 'active' })],
        error: null
      },
      active_user_bundles: {
        data: [{ bundle_tier_id: 'suite-other', status: 'trialing', current_period_end: '2026-09-10T00:00:00.000Z' }],
        error: null
      },
      bundle_tier_mappings: {
        data: [
          {
            bundle_tier_id: 'suite-other',
            bundle_tiers: { name: 'Ocean Bundle' },
            tiers: { id: 'tier-ocean', name: 'Premium', product_id: 'other-product', products: { name: 'Ocean Sentinel' } }
          }
        ],
        error: null
      },
      tier_features: { data: [{ features: { feature_key: 'n2k_stream' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.status).toBe('active');
    expect(ent.currentPeriodEnd).toBeNull();
  });
});

describe('fetchEntitlements: the account picture', () => {
  it('includes products the caller did not ask about', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [
          sub({ id: 'tier-basic', name: 'Basic', product_id: PRODUCT, product: 'Harbor Sentinel' }),
          sub({ id: 'tier-ocean', name: 'Premium', product_id: 'other-product', product: 'Ocean Sentinel' })
        ],
        error: null
      },
      active_user_bundles: { data: [], error: null },
      tier_features: { data: [{ features: { feature_key: 'anchor_alarm' } }], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    // Gating is unchanged: only this product's tier grants features.
    expect(ent.features).toEqual(['anchor_alarm']);
    expect(ent.tierNames).toEqual(['Basic']);
    expect(ent.account?.products).toEqual([
      { productId: PRODUCT, productName: 'Harbor Sentinel', tierNames: ['Basic'] },
      { productId: 'other-product', productName: 'Ocean Sentinel', tierNames: ['Premium'] }
    ]);
    expect(ent.account?.bundleNames).toEqual([]);
  });

  // "You have Ocean, but not this one" is precisely what a pill must be able to
  // say, so the empty grant carries the account picture too.
  it('carries the account picture when this product holds no tier', async () => {
    const supabase = makeMockSupabase({
      active_user_subscriptions: {
        data: [sub({ id: 'tier-ocean', name: 'Premium', product_id: 'other-product', product: 'Ocean Sentinel' })],
        error: null
      },
      active_user_bundles: { data: [], error: null }
    });

    const ent = await fetchEntitlements(supabase, 'user-1', PRODUCT);
    expect(ent.features).toEqual([]);
    expect(ent.tierNames).toEqual([]);
    expect(ent.status).toBeUndefined();
    expect(ent.currentPeriodEnd).toBeUndefined();
    expect(ent.account?.products).toEqual([
      { productId: 'other-product', productName: 'Ocean Sentinel', tierNames: ['Premium'] }
    ]);
  });

  it('adds no round trips: the same queries, reaching further', async () => {
    const calls: { table: string; select: string }[] = [];
    const supabase = makeMockSupabase(
      {
        active_user_subscriptions: {
          data: [sub({ id: 'tier-basic', name: 'Basic', product_id: PRODUCT })],
          error: null
        },
        active_user_bundles: {
          data: [{ bundle_tier_id: 'suite-premium', status: 'active', current_period_end: null }],
          error: null
        },
        bundle_tier_mappings: {
          data: [
            {
              bundle_tier_id: 'suite-premium',
              bundle_tiers: { name: 'Premium Suite' },
              tiers: { id: 'tier-premium', name: 'Premium', product_id: PRODUCT, products: { name: 'Harbor Sentinel' } }
            }
          ],
          error: null
        },
        tier_features: { data: [{ features: { feature_key: 'anchor_alarm' } }], error: null }
      },
      calls
    );

    await fetchEntitlements(supabase, 'user-1', PRODUCT);

    expect(calls.map((c) => c.table)).toEqual([
      'active_user_subscriptions',
      'active_user_bundles',
      'bundle_tier_mappings',
      'tier_features'
    ]);
    expect(calls[0].select).toContain('status');
    expect(calls[0].select).toContain('current_period_end');
    expect(calls[0].select).toContain('products(name)');
    expect(calls[1].select).toContain('current_period_end');
    expect(calls[2].select).toContain('bundle_tiers(name)');
  });
});

describe('entitlements cache: the display fields', () => {
  it('round-trips status, period end and the account picture', () => {
    const written = {
      features: ['n2k_stream'],
      tierNames: ['Premium'],
      fetchedAt: 123,
      status: 'trialing' as const,
      currentPeriodEnd: 1790000000000,
      account: {
        bundleNames: ['Premium Suite'],
        products: [{ productId: PRODUCT, productName: 'Harbor Sentinel', tierNames: ['Premium'] }]
      }
    };
    writeEntitlements(storage, KEY, written);
    expect(readEntitlements(storage, KEY)).toEqual(written);
  });

  it('keeps null period end distinct from an absent one', () => {
    writeEntitlements(storage, KEY, {
      features: [],
      tierNames: ['Premium'],
      fetchedAt: 1,
      status: 'active',
      currentPeriodEnd: null
    });
    expect(readEntitlements(storage, KEY)?.currentPeriodEnd).toBeNull();
  });

  // A cache written by the version before this change must keep parsing, and
  // simply have nothing to say about the plan until the next online refresh.
  // Nobody is signed out and no feature is lost by upgrading.
  it('still parses a v1 cache, with the new fields undefined', () => {
    storage.setItem(
      CACHE_KEY,
      JSON.stringify({ features: ['anchor_alarm', 'n2k_stream'], tierNames: ['Premium'], fetchedAt: 42 })
    );
    const ent = readEntitlements(storage, KEY);
    expect(ent).toEqual({ features: ['anchor_alarm', 'n2k_stream'], tierNames: ['Premium'], fetchedAt: 42 });
    expect(ent?.status).toBeUndefined();
    expect(ent?.currentPeriodEnd).toBeUndefined();
    expect(ent?.account).toBeUndefined();
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(true);
    expect(hasFeature(storage, KEY, 'ai_assistant')).toBe(false);
  });

  it('drops a corrupt status rather than throwing', () => {
    storage.setItem(
      CACHE_KEY,
      JSON.stringify({ features: ['n2k_stream'], tierNames: [], fetchedAt: 1, status: 'cancelled' })
    );
    expect(readEntitlements(storage, KEY)?.status).toBeUndefined();
    storage.setItem(CACHE_KEY, JSON.stringify({ features: [], tierNames: [], fetchedAt: 1, status: { on: true } }));
    expect(readEntitlements(storage, KEY)?.status).toBeUndefined();
    // The gate still answers from features alone.
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(false);
  });

  it('drops a corrupt period end rather than throwing', () => {
    // A date string is a wrong type here, not a value to parse: the cache
    // stores epoch ms. (NaN is not in this list because JSON cannot carry it —
    // it serialises to null, which legitimately means open-ended.)
    for (const bad of ['2026-10-01', {}, [], true]) {
      storage.setItem(
        CACHE_KEY,
        JSON.stringify({ features: [], tierNames: [], fetchedAt: 1, currentPeriodEnd: bad })
      );
      expect(readEntitlements(storage, KEY)?.currentPeriodEnd).toBeUndefined();
    }
  });

  it('drops a corrupt account picture, and corrupt parts of a valid one', () => {
    storage.setItem(CACHE_KEY, JSON.stringify({ features: [], tierNames: [], fetchedAt: 1, account: 'nope' }));
    expect(readEntitlements(storage, KEY)?.account).toBeUndefined();

    storage.setItem(
      CACHE_KEY,
      JSON.stringify({
        features: ['n2k_stream'],
        tierNames: [],
        fetchedAt: 1,
        account: {
          bundleNames: 'nope',
          products: [
            { productId: PRODUCT, productName: 7, tierNames: ['Premium', 3] },
            { productName: 'no id at all', tierNames: [] },
            'not an object'
          ]
        }
      })
    );
    expect(readEntitlements(storage, KEY)?.account).toEqual({
      bundleNames: [],
      products: [{ productId: PRODUCT, productName: '', tierNames: ['Premium'] }]
    });
    // And the cache is still a working cache.
    expect(hasFeature(storage, KEY, 'n2k_stream')).toBe(true);
  });
});
