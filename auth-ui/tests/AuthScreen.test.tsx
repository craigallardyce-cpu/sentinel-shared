import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AuthScreen } from '../src/AuthScreen';
import { memoryStorage } from './memoryStorage';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web'
  }
}));
vi.mock('@capacitor/device', () => ({
  Device: { getId: vi.fn() }
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
    tierFeatures = [{ features: { feature_key: 'anchor_alarm' } }]
  } = opts;

  let authChangeHandler: ((event: string, session: any) => void) | null = null;

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
      if (table === 'devices') return makeQueryBuilder({ data: devices, error: null });
      // Verification refreshes the entitlement cache. This table used to throw
      // here, and refreshEntitlements swallows failures by design, so the cache
      // was never written and nothing noticed.
      if (table === 'tier_features') return makeQueryBuilder({ data: tierFeatures, error: null });
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async () => ({ data: deviceLimits, error: null })),
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
