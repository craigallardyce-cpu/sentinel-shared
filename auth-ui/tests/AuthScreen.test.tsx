import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AuthScreen, offlineGrantUserId, watchForSignOut, DELETE_ACCOUNT_URL, PASSWORD_RESET_URL, TERMS_VERSION, TERMS_URL, TERMS_REQUIRED_MESSAGE, PRIVACY_URL } from '../src/AuthScreen';
import { memoryStorage } from './memoryStorage';
import { writeEntitlements } from '../src/entitlements';

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
  Device: {
    getId: vi.fn(async () => ({ identifier: 'test-device-id' })),
    getInfo: vi.fn(async () => ({ manufacturer: 'samsung', model: 'SM-S711U', operatingSystem: 'android', osVersion: '16' }))
  }
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
  /** Answers for successive inserts into devices, in order; each defaults to success. */
  deviceInsertErrors?: any[];
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
    tierFeaturesError = null,
    deviceInsertErrors = []
  } = opts;
  let deviceInserts = 0;

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
        builder.insert = vi.fn(() => Promise.resolve({ data: null, error: deviceInsertErrors[deviceInserts++] ?? null }));
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

  /*
    The apps had no way to reset a forgotten password; the website's Account
    page does (roadmap #105). The link opens it the way the Terms and Delete
    account links do, which the Electron shell and Android hand to the system
    browser, and it belongs to signing in only.
  */
  it('offers "Forgot your password?" on sign-in, opening the website, and not on sign-up', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
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
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    expect(PASSWORD_RESET_URL).toBe('https://marinersentinel.com/account#sign-in');
    expect(open).toHaveBeenCalledWith(PASSWORD_RESET_URL, '_blank', 'noopener,noreferrer');
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    expect(await screen.findByText('Create your credentials for free')).toBeInTheDocument();
    expect(screen.queryByText('Forgot your password?')).not.toBeInTheDocument();
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

    expect(await screen.findByText('No active plan')).toBeInTheDocument();
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

/*
  The no-plan screen cannot ask the server why there is no plan: the
  active_user_* views stop returning an expired trial, exactly as they return
  nothing for an account that never subscribed. What the device does know is
  the entitlement cache its last successful verification wrote, and a refused
  check leaves that cache standing. These tests seed it as that verification
  would have, then let the server refuse.
*/
describe('AuthScreen — lapsed trial notice', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const accessStorageKey = 'vesselkeeper_access';

  const seedCache = (status: 'active' | 'trialing', currentPeriodEnd: number) =>
    writeEntitlements(storage, accessStorageKey, {
      features: ['maintenance_log'],
      tierNames: ['Standalone'],
      fetchedAt: currentPeriodEnd - 30 * DAY,
      status,
      currentPeriodEnd
    });

  const renderRefused = () => {
    const supabase = makeMockSupabase({ session: { user: { id: 'user-1' } }, subscriptions: [] });
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey={accessStorageKey}
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
      />
    );
  };

  it('says when the free trial ended, when the cached grant was a trial that has passed', async () => {
    const ended = Date.now() - 3 * DAY;
    seedCache('trialing', ended);
    renderRefused();

    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    const date = new Date(ended).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    expect(screen.getByText(`Your Vessel Keeper free trial ended on ${date}.`)).toBeInTheDocument();
    expect(screen.queryByText('No active Vessel Keeper subscription found.')).not.toBeInTheDocument();
  });

  it('keeps the generic line when this device holds no cache', async () => {
    renderRefused();

    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('No active Vessel Keeper subscription found.')).toBeInTheDocument();
    expect(screen.queryByText(/free trial ended/)).not.toBeInTheDocument();
  });

  it('keeps the generic line for a paid plan that lapsed — only trials get the notice', async () => {
    seedCache('active', Date.now() - 3 * DAY);
    renderRefused();

    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('No active Vessel Keeper subscription found.')).toBeInTheDocument();
    expect(screen.queryByText(/free trial ended/)).not.toBeInTheDocument();
  });

  it('keeps the generic line when the cached trial has not ended but the server refused anyway', async () => {
    seedCache('trialing', Date.now() + 10 * DAY);
    renderRefused();

    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('No active Vessel Keeper subscription found.')).toBeInTheDocument();
    expect(screen.queryByText(/free trial ended/)).not.toBeInTheDocument();
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

/*
  A Play build sells nothing and may not point anywhere else to pay. The
  desktop keeps the website's checkout steps; a native build says only that the
  account has no plan, and keeps account management.
*/
describe('AuthScreen — store builds say nothing about buying', () => {
  function renderScreen(session: any) {
    const supabase = makeMockSupabase({ session, subscriptions: [] });
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
  }

  it('gives the website checkout steps on a desktop', async () => {
    renderScreen({ user: { id: 'user-1', email: 'skipper@example.com' } });
    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('Choose a subscription plan and complete checkout.')).toBeInTheDocument();
  });

  it('names no website, plan choice or payment on a native build', async () => {
    platform.isNative = true;
    renderScreen({ user: { id: 'user-1', email: 'skipper@example.com' } });
    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/marinersentinel\.com/i);
    expect(text).not.toMatch(/checkout|payment|subscription plan|choose a/i);
    expect(screen.getByText(/unlocks by itself as soon as this account has an active plan/)).toBeInTheDocument();
    expect(screen.getByText('Check Again')).toBeInTheDocument();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('keeps the website billing line at sign-up on a desktop only', async () => {
    renderScreen(null);
    await screen.findByText('Sign in to continue');
    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    expect(screen.getByText(/Billing setup is handled externally on our website/)).toBeInTheDocument();
    cleanup();

    platform.isNative = true;
    renderScreen(null);
    await screen.findByText('Sign in to continue');
    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    expect(screen.getByText('Creating an account registers your credentials.')).toBeInTheDocument();
    expect(screen.queryByText(/Billing setup/)).not.toBeInTheDocument();
  });
});

describe('AuthScreen — Delete account on the no-plan screen', () => {
  function renderNoPlan() {
    const supabase = makeMockSupabase({ session: { user: { id: 'user-1', email: 'skipper@example.com' } }, subscriptions: [] });
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
  }

  it('opens the website deletion dialog, the address Settings uses', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderNoPlan();
    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete account'));
    expect(open).toHaveBeenCalledWith('https://marinersentinel.com/account#delete-account', '_blank', 'noopener,noreferrer');
    expect(DELETE_ACCOUNT_URL).toBe('https://marinersentinel.com/account#delete-account');
    open.mockRestore();
  });

  it('names the signed-in account when the app opened with a stored session', async () => {
    renderNoPlan();
    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('skipper@example.com')).toBeInTheDocument();
  });

  it('is offered on a native build too, where Play requires it', async () => {
    platform.isNative = true;
    renderNoPlan();
    expect(await screen.findByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('Delete account')).toBeInTheDocument();
  });
});

describe('AuthScreen — age confirmation at sign-up', () => {
  function renderSignUp() {
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
    return supabase;
  }

  async function openSignUp() {
    await screen.findByText('Sign in to continue');
    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'skipper@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'correct-horse' } });
  }

  it('asks for the age confirmation on the sign-up form only', async () => {
    renderSignUp();
    await screen.findByText('Sign in to continue');
    expect(screen.queryByText(/18 or older/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    expect(screen.getByLabelText(/I'm 18 or older, or the age of majority where I live/)).toBeInTheDocument();
  });

  it('does not register an account until the box is ticked', async () => {
    const supabase = renderSignUp();
    await openSignUp();
    fireEvent.submit(screen.getByText('Register Account').closest('form')!);
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    expect(await screen.findByText(/confirm that you are 18 or older/)).toBeInTheDocument();
  });

  it('records when the age was confirmed on the new account', async () => {
    // No session comes back, so the form announces the registration with alert().
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const supabase = renderSignUp();
    await openSignUp();
    fireEvent.click(screen.getByLabelText(/I'm 18 or older/));
    fireEvent.submit(screen.getByText('Register Account').closest('form')!);
    await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalledTimes(1));
    const args = supabase.auth.signUp.mock.calls[0][0];
    expect(args.email).toBe('skipper@example.com');
    expect(typeof args.options.data.age_confirmed_at).toBe('string');
    expect(Number.isNaN(Date.parse(args.options.data.age_confirmed_at))).toBe(false);
  });
});

describe('AuthScreen — Terms agreement at sign-up (Terms TD10)', () => {
  function renderSignUp(termsVersion?: string | null) {
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
        {...(termsVersion === undefined ? {} : { termsVersion })}
      />
    );
    return supabase;
  }

  async function openSignUp() {
    await screen.findByText('Sign in to continue');
    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'skipper@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByLabelText(/I'm 18 or older/));
  }

  it('shows no agreement box until the Terms are published', async () => {
    expect(TERMS_VERSION).toBeNull();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const supabase = renderSignUp();
    await openSignUp();
    expect(screen.queryByText(/I agree to the/)).not.toBeInTheDocument();
    fireEvent.submit(screen.getByText('Register Account').closest('form')!);
    await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalledTimes(1));
    const data = supabase.auth.signUp.mock.calls[0][0].options.data;
    expect(data.terms_version).toBeUndefined();
    expect(data.terms_accepted_at).toBeUndefined();
  });

  it('does not register an account until the Terms box is ticked', async () => {
    const supabase = renderSignUp('2027-05-01');
    await openSignUp();
    fireEvent.submit(screen.getByText('Register Account').closest('form')!);
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    expect(await screen.findByText(TERMS_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it('records which Terms were agreed to, and when', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const supabase = renderSignUp('2027-05-01');
    await openSignUp();
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.submit(screen.getByText('Register Account').closest('form')!);
    await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalledTimes(1));
    const data = supabase.auth.signUp.mock.calls[0][0].options.data;
    expect(data.terms_version).toBe('2027-05-01');
    expect(data.terms_accepted_at).toBe(data.age_confirmed_at);
  });

  it('opens each document on the website without ticking the box', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderSignUp('2027-05-01');
    await openSignUp();
    fireEvent.click(screen.getByText('Terms of Service'));
    fireEvent.click(screen.getByText('Privacy Policy'));
    expect(open.mock.calls.map((c) => c[0])).toEqual([TERMS_URL, PRIVACY_URL]);
    expect(screen.getByLabelText(/I agree to the/)).not.toBeChecked();
    // The sentence itself still ticks it.
    fireEvent.click(screen.getByText(/I agree to the/));
    expect(screen.getByLabelText(/I agree to the/)).toBeChecked();
  });
});

/*
 * Roadmap #136: the account page could not tell one "Android Phone/Tablet" from
 * another. The label rides along with registration, and must never be the
 * reason a sign-in fails -- a database without website migration 084 does not
 * know the column.
 */
describe('AuthScreen — device label for the account page', () => {
  const session = { user: { id: 'user-1' } };
  const premium = [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }];

  function renderScreen(supabase: any, onAuthenticated = vi.fn()) {
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
      />
    );
    return onAuthenticated;
  }

  it('registers a phone with its make, model and OS', async () => {
    platform.isNative = true;
    const supabase = makeMockSupabase({ session, subscriptions: premium });
    const onAuthenticated = renderScreen(supabase);
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    const inserted = supabase.__deviceBuilders.find((b: any) => b.insert.mock.calls.length > 0);
    expect(inserted.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        device_identifier: 'test-device-id',
        device_name: 'Android Phone/Tablet',
        device_model: 'Samsung SM-S711U · Android 16'
      })
    );
  });

  it('registers without the label when the database has no column for it', async () => {
    platform.isNative = true;
    const supabase = makeMockSupabase({
      session,
      subscriptions: premium,
      deviceInsertErrors: [{ code: 'PGRST204', message: "Could not find the 'device_model' column" }]
    });
    const onAuthenticated = renderScreen(supabase);
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    const calls = supabase.__deviceBuilders.flatMap((b: any) => b.insert.mock.calls.map((c: any[]) => c[0]));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveProperty('device_model');
    expect(calls[1]).not.toHaveProperty('device_model');
    expect(calls[1]).toMatchObject({ device_identifier: 'test-device-id', product_id: 'prod-1' });
  });

  it('refreshes the label on every row of a device already registered', async () => {
    platform.isNative = true;
    const supabase = makeMockSupabase({
      session,
      subscriptions: premium,
      devices: [{ id: 'row-1', product_id: 'prod-1' }]
    });
    const onAuthenticated = renderScreen(supabase);
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    const labelled = supabase.__deviceBuilders.find((b: any) =>
      b.update.mock.calls.some((c: any[]) => 'device_model' in c[0])
    );
    expect(labelled.update).toHaveBeenCalledWith({ device_model: 'Samsung SM-S711U · Android 16' });
    expect(labelled.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(labelled.eq).toHaveBeenCalledWith('device_identifier', 'test-device-id');
    // The check-in itself is still its own write, untouched by the label.
    const checkIn = supabase.__deviceBuilders.find((b: any) =>
      b.update.mock.calls.some((c: any[]) => 'last_active_at' in c[0])
    );
    expect(checkIn.update.mock.calls[0][0]).not.toHaveProperty('device_model');
  });

  it('sends no label from the desktop app', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: premium });
    const onAuthenticated = renderScreen(supabase);
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    const inserted = supabase.__deviceBuilders.find((b: any) => b.insert.mock.calls.length > 0);
    expect(inserted.insert.mock.calls[0][0]).not.toHaveProperty('device_model');
  });
});

/*
 * The 2026-11-15 review of this package. Every test above reaches a refusal
 * from a stored session, where nobody pressed a button; these reach it the way
 * a person does, by typing a sign-in, and from two directions at once.
 */
describe('AuthScreen — a typed sign-in that is refused (review H1)', () => {
  const session = { user: { id: 'user-1' } };

  function renderScreen(supabase: any, extra: Record<string, unknown> = {}) {
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
        {...extra}
      />
    );
    return onAuthenticated;
  }

  /** Types a sign-in; auth-js answers it with SIGNED_IN, as the real client does. */
  async function typeSignIn(supabase: any) {
    await screen.findByText('Sign in to continue');
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'cap@ship.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(supabase.auth.signInWithPassword).toHaveBeenCalled());
    supabase.__triggerAuthChange('SIGNED_IN', session);
  }

  it('leaves Check Again and Sign Out usable on the no-plan screen', async () => {
    const supabase = makeMockSupabase({ session: null, subscriptions: [] });
    renderScreen(supabase);
    await typeSignIn(supabase);

    await screen.findByText('No active plan');
    await waitFor(() => expect(screen.getByRole('button', { name: /Check Again/ })).toBeEnabled());
    expect(screen.queryByText('Checking...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign Out/ })).toBeEnabled();
  });

  it('leaves Sign In usable after a device-limit refusal, so it can be tried again', async () => {
    const supabase = makeMockSupabase({
      session: null,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }],
      deviceLimits: [{ active_devices: 5, max_devices: 5 }]
    });
    renderScreen(supabase);
    await typeSignIn(supabase);

    await screen.findByText(/Device limit reached/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled());
    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
  });

  it('leaves Sign In usable after the desktop-needs-Premium refusal', async () => {
    const supabase = makeMockSupabase({
      session: null,
      subscriptions: [{ tiers: { id: 'tier-basic', name: 'Basic', product_id: 'prod-1' } }],
      tierFeatures: [{ features: { feature_key: 'anchor_alarm' } }]
    });
    renderScreen(supabase, { desktopRequiresFeature: 'n2k_stream' });
    await typeSignIn(supabase);

    await screen.findByText(/needs Premium to run here/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled());
  });
});

describe('AuthScreen — one access check at a time (review L11)', () => {
  const session = { user: { id: 'user-1' } };
  const premium = [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }];
  const inserts = (supabase: any) =>
    supabase.__deviceBuilders.reduce((n: number, b: any) => n + b.insert.mock.calls.length, 0);

  function renderScreen(supabase: any) {
    const onAuthenticated = vi.fn();
    const view = render(
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
      />
    );
    return { onAuthenticated, view };
  }

  it('registers the device once when a stored session and SIGNED_IN both ask', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: premium });
    const { onAuthenticated } = renderScreen(supabase);
    // auth-js emits this as it restores the stored session, beside getSession().
    supabase.__triggerAuthChange('SIGNED_IN', session);
    supabase.__triggerAuthChange('SIGNED_IN', session);

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inserts(supabase)).toBe(1);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('registers the device once at sign-up, where the handler and SIGNED_IN both ask', async () => {
    const supabase = makeMockSupabase({ session: null, subscriptions: premium });
    supabase.auth.signUp = vi.fn(async () => {
      supabase.__triggerAuthChange('SIGNED_IN', session);
      return { data: { session }, error: null };
    });
    const { onAuthenticated } = renderScreen(supabase);
    await screen.findByText('Sign in to continue');
    fireEvent.click(screen.getByText("Don't have an account? Create one"));
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'skipper@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByLabelText(/I'm 18 or older/));
    fireEvent.submit(screen.getByText('Register Account').closest('form')!);

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inserts(supabase)).toBe(1);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('checks again for a later request, once the first has finished', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    renderScreen(supabase);
    await screen.findByText('No active plan');
    const before = supabase.from.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Check Again/ }));
    await waitFor(() => expect(supabase.from.mock.calls.length).toBeGreaterThan(before));
  });

  it('starts no polling timer when the screen has gone before its session lookup answers', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    // The first lookup is the one on mount. The second belongs to the no-plan
    // polling, and is held open until after the screen is taken down.
    let release!: (value: any) => void;
    const held = new Promise((resolve) => (release = resolve));
    const lookups = { count: 0 };
    supabase.auth.getSession = vi.fn(() => {
      lookups.count += 1;
      return lookups.count === 2 ? held : Promise.resolve({ data: { session } });
    });
    const { view } = renderScreen(supabase);
    await screen.findByText('No active plan');
    await waitFor(() => expect(lookups.count).toBe(2));

    view.unmount();
    const timers = vi.spyOn(globalThis, 'setInterval');
    release({ data: { session } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers.mock.calls.filter((call) => call[1] === 5000)).toHaveLength(0);
  });
});

describe('AuthScreen — telling the app the session ended (VesselKeeper review M1)', () => {
  const session = { user: { id: 'user-1' } };
  const KEY = 'vesselkeeper_access';

  function renderNoPlan(supabase: any, onSignedOut: any) {
    storage.setItem(KEY, 'true');
    storage.setItem(`${KEY}_offline_grant`, JSON.stringify({ userId: 'user-1', grantedAt: Date.now() }));
    writeEntitlements(storage, KEY, { features: ['anchor_alarm'], tierNames: ['Premium'], fetchedAt: Date.now() });
    render(
      <AuthScreen
        storage={storage}
        appName="Vessel Keeper"
        appId="VesselKeeper"
        accessStorageKey={KEY}
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={vi.fn()}
        onSignedOut={onSignedOut}
      />
    );
  }

  const cleared = () =>
    storage.getItem(KEY) === null &&
    storage.getItem(`${KEY}_offline_grant`) === null &&
    storage.getItem(`${KEY}_entitlements`) === null;

  it('calls the hook once when Sign Out is pressed and auth-js reports it', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    supabase.auth.signOut = vi.fn(async () => {
      supabase.__triggerAuthChange('SIGNED_OUT', null);
      return { error: null };
    });
    const onSignedOut = vi.fn();
    renderNoPlan(supabase, onSignedOut);
    await screen.findByText('No active plan');
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/ }));

    await screen.findByText('Sign in to continue');
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(cleared()).toBe(true);
  });

  it('still calls it once when the sign-out could not reach the server and no event came', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    supabase.auth.signOut = vi.fn(async () => ({ error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } }));
    const onSignedOut = vi.fn();
    renderNoPlan(supabase, onSignedOut);
    await screen.findByText('No active plan');
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/ }));

    await screen.findByText('Sign in to continue');
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(cleared()).toBe(true);
  });

  it('calls it for a sign-out that came from somewhere else', async () => {
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    const onSignedOut = vi.fn();
    renderNoPlan(supabase, onSignedOut);
    await screen.findByText('No active plan');
    supabase.__triggerAuthChange('SIGNED_OUT', null);

    await screen.findByText('Sign in to continue');
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(cleared()).toBe(true);
  });

  it('is not held up or broken by a hook that fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeMockSupabase({ session, subscriptions: [] });
    renderNoPlan(supabase, vi.fn(async () => { throw new Error('cache would not clear'); }));
    await screen.findByText('No active plan');
    supabase.__triggerAuthChange('SIGNED_OUT', null);
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
  });
});

describe('watchForSignOut — hearing the session end after sign-in (VesselKeeper review M4)', () => {
  const KEY = 'vesselkeeper_access';

  function seeded() {
    storage.setItem(KEY, 'true');
    storage.setItem(`${KEY}_offline_grant`, JSON.stringify({ userId: 'user-1', grantedAt: Date.now() }));
    writeEntitlements(storage, KEY, { features: ['anchor_alarm'], tierNames: ['Premium'], fetchedAt: Date.now() });
  }

  it('clears what admitted this device and tells the app, on SIGNED_OUT only', () => {
    seeded();
    const supabase = makeMockSupabase();
    const onSignedOut = vi.fn();
    watchForSignOut(supabase, { storage, accessStorageKey: KEY, onSignedOut });

    supabase.__triggerAuthChange('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    supabase.__triggerAuthChange('SIGNED_IN', { user: { id: 'user-1' } });
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(storage.getItem(KEY)).toBe('true');

    supabase.__triggerAuthChange('SIGNED_OUT', null);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(storage.getItem(KEY)).toBeNull();
    expect(storage.getItem(`${KEY}_offline_grant`)).toBeNull();
    expect(storage.getItem(`${KEY}_entitlements`)).toBeNull();
  });

  it('stops listening when asked', () => {
    const supabase = makeMockSupabase();
    const stop = watchForSignOut(supabase, { storage, accessStorageKey: KEY, onSignedOut: vi.fn() });
    const subscription = supabase.auth.onAuthStateChange.mock.results[0].value.data.subscription;
    stop();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not let a failing hook reach auth-js', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeMockSupabase();
    watchForSignOut(supabase, { storage, accessStorageKey: KEY, onSignedOut: () => { throw new Error('boom'); } });
    expect(() => supabase.__triggerAuthChange('SIGNED_OUT', null)).not.toThrow();
  });
});

describe('offlineGrantUserId — who an offline start was admitted as (OceanSentinel review M3)', () => {
  const KEY = 'oceansentinel_access';
  const DAY = 24 * 60 * 60 * 1000;
  const offline = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' };

  function grant(userId: string, ageDays: number, verified = true) {
    if (verified) storage.setItem(KEY, 'true');
    storage.setItem(`${KEY}_offline_grant`, JSON.stringify({ userId, grantedAt: Date.now() - ageDays * DAY }));
  }

  it('names the account the last online verification was for, when the session could not be fetched', async () => {
    const session = { user: { id: 'user-7' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { id: 'tier-premium', name: 'Premium', product_id: 'prod-1' } }]
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
        storage={storage}
        appName="Ocean Sentinel"
        appId="OceanSentinel"
        accessStorageKey={KEY}
        productId="prod-1"
        supabase={supabase}
        isConfigured={true}
        fetchMachineId={fetchMachineId}
        onAuthenticated={onAuthenticated}
        offlineGraceDays={30}
      />
    );
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(offlineGrantUserId(storage, KEY, 30, offline)).toBe('user-7');
  });

  it('answers when the browser says it is offline, with no error to go on', () => {
    grant('user-7', 3);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(offlineGrantUserId(storage, KEY, 30)).toBe('user-7');
  });

  it('is null while online with no fetch failure: no session then means signed out', () => {
    grant('user-7', 3);
    expect(offlineGrantUserId(storage, KEY, 30)).toBeNull();
    expect(offlineGrantUserId(storage, KEY, 30, { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token' })).toBeNull();
  });

  it('is null once the allowance has run out, or where the app grants none', () => {
    grant('user-7', 31);
    expect(offlineGrantUserId(storage, KEY, 30, offline)).toBeNull();
    grant('user-7', 3);
    expect(offlineGrantUserId(storage, KEY, 0, offline)).toBeNull();
  });

  it('is null for a device that never verified, or holds no readable grant', () => {
    grant('user-7', 3, false);
    expect(offlineGrantUserId(storage, KEY, 30, offline)).toBeNull();
    storage.setItem(KEY, 'true');
    storage.setItem(`${KEY}_offline_grant`, 'not json');
    expect(offlineGrantUserId(storage, KEY, 30, offline)).toBeNull();
    storage.removeItem(`${KEY}_offline_grant`);
    expect(offlineGrantUserId(storage, KEY, 30, offline)).toBeNull();
  });

  it('is null after a sign-out, which clears the grant', () => {
    grant('user-7', 3);
    const supabase = makeMockSupabase();
    watchForSignOut(supabase, { storage, accessStorageKey: KEY, onSignedOut: vi.fn() });
    supabase.__triggerAuthChange('SIGNED_OUT', null);
    expect(offlineGrantUserId(storage, KEY, 30, offline)).toBeNull();
  });
});
