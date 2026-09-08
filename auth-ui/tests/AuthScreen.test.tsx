import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AuthScreen } from '../src/AuthScreen';
import { memoryStorage } from './memoryStorage';

// Mutable so a test can run the component as if it were on a phone. Hoisted
// with the vi.mock factory, which runs at import time — a plain `let` here
// would still be in its temporal dead zone when the factory first reads it.
const platform = vi.hoisted(() => ({ isNative: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.isNative,
    getPlatform: () => (platform.isNative ? 'android' : 'web')
  }
}));
vi.mock('@capacitor/device', () => ({
  Device: { getId: vi.fn(async () => ({ identifier: 'test-device-id' })) }
}));

/*
  AuthScreen takes its store as a required prop, on purpose: one of the three
  apps runs its server in the same process, and the keys built from
  `accessStorageKey` are invisible to every check the fleet has unless the app
  hands the store over. These tests were still asserting against the
  `localStorage` global while passing no `storage` at all, so the component was
  writing to `undefined`.
*/
const storage = memoryStorage();

afterEach(() => {
  cleanup();
  storage.clear();
  platform.isNative = false;
  vi.restoreAllMocks();
});

// A chainable stand-in for Supabase's PostgrestFilterBuilder: every filter method
// returns itself, and the object is thenable so `await` resolves to `result`.
function makeQueryBuilder(result: { data: any; error: any }) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  };
  return builder;
}

interface MockSupabaseOptions {
  session?: any;
  subscriptions?: any[];
  bundles?: any[];
  bundleMappings?: any[];
  devices?: any;
  deviceLimits?: any[];
  signInError?: any;
  /** tier_features rows, in the shape fetchEntitlements selects them. */
  tierFeatures?: any[];
  /** When set, tier_features answers with this error, so fetchEntitlements throws. */
  tierFeaturesError?: any;
}

function makeMockSupabase(opts: MockSupabaseOptions = {}) {
  const {
    session = null,
    subscriptions = [],
    bundles = [],
    bundleMappings = [],
    devices = null,
    deviceLimits = [{ active_devices: 0, max_devices: 5 }],
    signInError = null,
    tierFeatures = [{ features: { feature_key: 'anchor_alarm' } }],
    tierFeaturesError = null
  } = opts;

  let authChangeHandler: ((event: string, session: any) => void) | null = null;
  // Every builder handed out for `devices`, so a test can read back the filters
  // the component applied and the row it tried to insert. A slot is now scoped
  // to a product, and that is only observable in those two places.
  const deviceBuilders: any[] = [];

  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn((cb: any) => {
        authChangeHandler = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn(async () => ({ error: signInError })),
      signUp: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn((table: string) => {
      if (table === 'active_user_subscriptions') return makeQueryBuilder({ data: subscriptions, error: null });
      if (table === 'active_user_bundles') return makeQueryBuilder({ data: bundles, error: null });
      if (table === 'bundle_tier_mappings') return makeQueryBuilder({ data: bundleMappings, error: null });
      if (table === 'devices') {
        const builder = makeQueryBuilder({ data: devices, error: null });
        deviceBuilders.push(builder);
        return builder;
      }
      // Verification refreshes the entitlement cache. This table used to throw
      // here, and refreshEntitlements swallows failures by design, so the cache
      // was never written and nothing noticed.
      if (table === 'tier_features') {
        return makeQueryBuilder(
          tierFeaturesError ? { data: null, error: tierFeaturesError } : { data: tierFeatures, error: null }
        );
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async () => ({ data: deviceLimits, error: null })),
    __deviceBuilders: deviceBuilders,
    __triggerAuthChange: (event: string, s: any) => authChangeHandler?.(event, s)
  };

  return supabase as any;
}

const fetchMachineId = async () => ({ machineId: 'test-machine-id' });

describe('AuthScreen — not configured', () => {
  it('shows the "not connected" gate and never touches supabase', () => {
    const supabase = makeMockSupabase();
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={false}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );
    expect(screen.getByText('Sign-In Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/HarborSentinel isn't connected to Supabase/)).toBeInTheDocument();
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });
});

describe('AuthScreen — login form', () => {
  it('shows the login form (with app name) once the session check resolves with no session', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );

    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.getByText('Harbor Sentinel')).toBeInTheDocument();
  });

  it('submits email/password via supabase.auth.signInWithPassword', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );

    await screen.findByText('Sign in to continue');
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'cap@ship.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'cap@ship.com', password: 'hunter2' });
    });
  });

  it('surfaces the error message when sign-in fails', async () => {
    const supabase = makeMockSupabase({ session: null, signInError: { message: 'Invalid credentials' } });
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );

    await screen.findByText('Sign in to continue');
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'cap@ship.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });

  it('does not render offline-mode buttons unless allowOfflineMode is set', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );
    await screen.findByText('Sign in to continue');
    expect(screen.queryByText('Run Offline (Local-Only Mode)')).not.toBeInTheDocument();
  });

  it('renders an offline-mode button that calls onAuthenticated when allowOfflineMode is true', async () => {
    const supabase = makeMockSupabase({ session: null });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Ocean Sentinel"
        appId="OceanSentinel"
        accessStorageKey="oceansentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
        allowOfflineMode={true}
      />
    );
    await screen.findByText('Sign in to continue');
    fireEvent.click(screen.getByText('Run Offline (Local-Only Mode)'));
    expect(onAuthenticated).toHaveBeenCalled();
  });
});

describe('AuthScreen — subscription gating', () => {
  it('shows the "no subscription" screen when the session has no matching active subscription', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );

    expect(await screen.findByText('Account Active')).toBeInTheDocument();
    expect(screen.getByText('No active Vessel Keeper subscription found.')).toBeInTheDocument();
  });

  it('registers the device and calls onAuthenticated when an active subscription is found', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      devices: null
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
      />
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(storage.getItem('vesselkeeper_access')).toBe('true');
    // The entitlement cache is written beside the access flag, and every
    // app's canUse() gate reads it. Nothing covered that wiring before.
    const cached = JSON.parse(storage.getItem('vesselkeeper_access_entitlements')!);
    expect(cached.features).toEqual(['anchor_alarm']);
    expect(cached.fetchedAt).toBeGreaterThan(0);
  });

  /*
   * A device slot is a DEVICE, across the whole fleet.
   *
   * The subscription covers every app it includes, so five devices means five
   * machines that may run any of them. The identifier carries that: desktop
   * reads real hardware, and Android's ANDROID_ID is scoped to the signing key
   * rather than the package, so the fleet's one keystore gives one handset one
   * value in all three apps. Rows stay per (device, product) so the account
   * page can show which apps a device runs; only the count is fleet-wide.
   */
  it('records which app registered the device, and looks the device up across all of them', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      devices: null
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
      />
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());

    // The lookup is by hardware alone -- narrowing it to this product would hide
    // the rows that prove the device already holds a slot.
    const [lookup] = supabase.__deviceBuilders;
    expect(lookup.eq).toHaveBeenCalledWith('device_identifier', 'test-machine-id');
    expect(lookup.eq).not.toHaveBeenCalledWith('product_id', 'prod-1');

    const inserted = supabase.__deviceBuilders.find((b: any) => b.insert.mock.calls.length > 0);
    expect(inserted).toBeDefined();
    expect(inserted.insert).toHaveBeenCalledWith(
      expect.objectContaining({ device_identifier: 'test-machine-id', product_id: 'prod-1' })
    );
  });

  it('asks for the account-wide limit, with no product argument', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      devices: null
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
      />
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(supabase.rpc).toHaveBeenCalledWith('get_user_device_limits');
  });

  /*
   * The trap this pair exists to catch.
   *
   * A phone that is already one of the account's five devices would, on a naive
   * check, be refused the moment it opened a fourth fleet app: active_devices
   * comes back 5 of 5 and the new row looks like a sixth device. It is not --
   * the hardware is already inside that five. So an identifier the account
   * already knows skips the ceiling entirely, and only genuinely new hardware
   * is measured against it.
   */
  it('registers a further app on a device the account already knows, even at the limit', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      devices: [{ id: 'row-harbor', product_id: 'prod-other' }],
      deviceLimits: [{ active_devices: 5, max_devices: 5 }]
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
      />
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    // Not even asked: the ceiling is irrelevant to hardware already inside it.
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_user_device_limits');
    const inserted = supabase.__deviceBuilders.find((b: any) => b.insert.mock.calls.length > 0);
    expect(inserted.insert).toHaveBeenCalledWith(
      expect.objectContaining({ device_identifier: 'test-machine-id', product_id: 'prod-1' })
    );
  });

  it('does not name an app in the limit message, because the count is the account’s', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      devices: null,
      deviceLimits: [{ active_devices: 5, max_devices: 5 }]
    });
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );

    const msg = await screen.findByText(/You are using 5 of 5 device slots/);
    expect(msg).toBeInTheDocument();
    expect(msg.textContent).not.toMatch(/Vessel Keeper device slots/);
  });

  it('blocks registration and shows an error when the device limit is reached', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      devices: null,
      deviceLimits: [{ active_devices: 5, max_devices: 5 }]
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
      />
    );

    expect(await screen.findByText(/Device limit reached/)).toBeInTheDocument();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});

describe('AuthScreen — desktopRequiresFeature', () => {
  /*
    Basic is a phone and tablet plan: max_devices 1, and a desktop has no GPS
    of its own. The guard therefore has to run before the devices table is
    touched at all — a desktop that consumes the single slot locks the customer
    out of the phone the plan is actually for, which is the bug this fixes.
  */
  const premiumSub = [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }];

  const renderHarbor = (supabase: any, props: Record<string, any> = {}) => {
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
        {...props}
      />
    );
    return onAuthenticated;
  };

  it('refuses on a desktop when the tier does not grant the feature, without touching devices', async () => {
    const supabase = makeMockSupabase({
      session: { user: { id: 'user-1' } },
      subscriptions: premiumSub,
      tierFeatures: [{ features: { feature_key: 'anchor_alarm' } }]
    });
    const onAuthenticated = renderHarbor(supabase, { desktopRequiresFeature: 'n2k_stream' });

    expect(
      await screen.findByText(/This plan runs on a phone or tablet, using that device's own GPS\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Harbor Sentinel needs Premium to run here/)).toBeInTheDocument();
    expect(onAuthenticated).not.toHaveBeenCalled();
    // The point of the ordering: no read, and above all no insert, so the
    // account's one device slot is still free for the phone.
    expect(supabase.from).not.toHaveBeenCalledWith('devices');
    expect(storage.getItem('harborsentinel_access')).toBeNull();
  });

  it('proceeds on a desktop when the tier grants the feature, and does not fetch entitlements twice', async () => {
    const supabase = makeMockSupabase({
      session: { user: { id: 'user-1' } },
      subscriptions: premiumSub,
      tierFeatures: [{ features: { feature_key: 'n2k_stream' } }]
    });
    const onAuthenticated = renderHarbor(supabase, { desktopRequiresFeature: 'n2k_stream' });

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(supabase.from).toHaveBeenCalledWith('devices');
    // The guard's own fetch is reused for the cache rather than repeated.
    const featureFetches = supabase.from.mock.calls.filter((c: any[]) => c[0] === 'tier_features');
    expect(featureFetches).toHaveLength(1);
    const cached = JSON.parse(storage.getItem('harborsentinel_access_entitlements')!);
    expect(cached.features).toEqual(['n2k_stream']);
  });

  it('does not apply on a native platform, whatever the tier grants', async () => {
    platform.isNative = true;
    const supabase = makeMockSupabase({
      session: { user: { id: 'user-1' } },
      subscriptions: premiumSub,
      tierFeatures: [{ features: { feature_key: 'anchor_alarm' } }]
    });
    const onAuthenticated = renderHarbor(supabase, { desktopRequiresFeature: 'n2k_stream' });

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(supabase.from).toHaveBeenCalledWith('devices');
  });

  it('does not apply when the prop is omitted — the VesselKeeper case', async () => {
    const supabase = makeMockSupabase({
      session: { user: { id: 'user-1' } },
      subscriptions: premiumSub,
      tierFeatures: [{ features: { feature_key: 'maintenance_log' } }]
    });
    const onAuthenticated = renderHarbor(supabase);

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(supabase.from).toHaveBeenCalledWith('devices');
  });

  it('fails OPEN and admits the user when the entitlement fetch throws', async () => {
    // "We could not check" is not "you do not have one". Same doctrine as
    // hasActiveSubscription and hasFeature with no cache.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeMockSupabase({
      session: { user: { id: 'user-1' } },
      subscriptions: premiumSub,
      tierFeaturesError: { message: 'network down' }
    });
    const onAuthenticated = renderHarbor(supabase, { desktopRequiresFeature: 'n2k_stream' });

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(screen.queryByText(/This plan runs on a phone or tablet/)).not.toBeInTheDocument();
  });

  it('keeps the previous entitlement cache when the fetch throws', async () => {
    // The invariant the reuse must not break: a failed lookup never takes
    // features away from a device that already has them cached.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.setItem(
      'harborsentinel_access_entitlements',
      JSON.stringify({ features: ['n2k_stream'], tierNames: ['Premium'], fetchedAt: 1 })
    );
    const supabase = makeMockSupabase({
      session: { user: { id: 'user-1' } },
      subscriptions: premiumSub,
      tierFeaturesError: { message: 'network down' }
    });
    const onAuthenticated = renderHarbor(supabase, { desktopRequiresFeature: 'n2k_stream' });

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    const cached = JSON.parse(storage.getItem('harborsentinel_access_entitlements')!);
    expect(cached.features).toEqual(['n2k_stream']);
  });
});

describe('AuthScreen — legacy storage migration', () => {
  it('migrates a value under legacyStorageKey to accessStorageKey on mount', async () => {
    storage.setItem('vesselsentinel_access', 'true');
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey="vesselkeeper_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
        legacyStorageKey="vesselsentinel_access"
      />
    );

    await waitFor(() => {
      expect(storage.getItem('vesselkeeper_access')).toBe('true');
      expect(storage.getItem('vesselsentinel_access')).toBeNull();
    });
  });

  it('does nothing when legacyStorageKey is not provided', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
        storage={storage}
        appName="Harbor Sentinel"
        appId="HarborSentinel"
        accessStorageKey="harborsentinel_access"
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );
    await screen.findByText('Sign in to continue');
    expect(storage.getItem('harborsentinel_access')).toBeNull();
    // Nothing at all was written, not merely nothing under that key.
    expect(storage.size()).toBe(0);
  });
});
