import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AuthScreen } from '../src/AuthScreen';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web'
  }
}));
vi.mock('@capacitor/device', () => ({
  Device: { getId: vi.fn() }
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
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
}

function makeMockSupabase(opts: MockSupabaseOptions = {}) {
  const {
    session = null,
    subscriptions = [],
    bundles = [],
    bundleMappings = [],
    devices = null,
    deviceLimits = [{ active_devices: 0, max_devices: 5 }],
    signInError = null
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
      if (table === 'user_subscriptions') return makeQueryBuilder({ data: subscriptions, error: null });
      if (table === 'user_bundles') return makeQueryBuilder({ data: bundles, error: null });
      if (table === 'bundle_tier_mappings') return makeQueryBuilder({ data: bundleMappings, error: null });
      if (table === 'devices') return makeQueryBuilder({ data: devices, error: null });
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

    expect(await screen.findByText('Sign in to access Harbor Sentinel')).toBeInTheDocument();
  });

  it('submits email/password via supabase.auth.signInWithPassword', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
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

    await screen.findByText('Sign in to access Harbor Sentinel');
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

    await screen.findByText('Sign in to access Harbor Sentinel');
    fireEvent.change(screen.getByPlaceholderText('captain@vessel.com'), { target: { value: 'cap@ship.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });

  it('does not render offline-mode buttons unless allowOfflineMode is set', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
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
    await screen.findByText('Sign in to access Harbor Sentinel');
    expect(screen.queryByText('Run Offline (Local-Only Mode)')).not.toBeInTheDocument();
  });

  it('renders an offline-mode button that calls onAuthenticated when allowOfflineMode is true', async () => {
    const supabase = makeMockSupabase({ session: null });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
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
    await screen.findByText('Sign in to access Ocean Sentinel');
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
      subscriptions: [{ tiers: { product_id: 'prod-1' } }],
      devices: null
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
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
    expect(localStorage.getItem('vesselkeeper_access')).toBe('true');
  });

  it('blocks registration and shows an error when the device limit is reached', async () => {
    const session = { user: { id: 'user-1' } };
    const supabase = makeMockSupabase({
      session,
      subscriptions: [{ tiers: { product_id: 'prod-1' } }],
      devices: null,
      deviceLimits: [{ active_devices: 5, max_devices: 5 }]
    });
    const onAuthenticated = vi.fn();
    render(
      <AuthScreen
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
    localStorage.setItem('vesselsentinel_access', 'true');
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
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
      expect(localStorage.getItem('vesselkeeper_access')).toBe('true');
      expect(localStorage.getItem('vesselsentinel_access')).toBeNull();
    });
  });

  it('does nothing when legacyStorageKey is not provided', async () => {
    const supabase = makeMockSupabase({ session: null });
    render(
      <AuthScreen
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
    await screen.findByText('Sign in to access Harbor Sentinel');
    expect(localStorage.getItem('harborsentinel_access')).toBeNull();
  });
});
