import React, { useState, useEffect } from 'react';
import { Anchor, ShieldCheck, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

/**
 * Structural (not imported) subset of Supabase's SupabaseClient — avoids a
 * nominal-typing mismatch when this package's own installed copy of
 * @supabase/supabase-js differs from the consuming app's copy (each app's
 * `supabase` instance still satisfies this shape at runtime either way).
 */
export interface SupabaseClientLike {
  auth: {
    getSession(): Promise<{ data: { session: any } }>;
    onAuthStateChange(
      callback: (event: string, session: any) => void
    ): { data: { subscription: { unsubscribe: () => void } } };
    signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: any }>;
    signUp(params: any): Promise<{ data: any; error: any }>;
    signOut(): Promise<{ error: any }>;
  };
  from(table: string): any;
  rpc(fn: string, args?: any): PromiseLike<{ data: any; error: any }>;
}

export interface AuthScreenProps {
  /** Two-word product name used in copy, e.g. "Harbor Sentinel". */
  appName: string;
  /** One-word app id used in the "not connected to Supabase" message, e.g. "HarborSentinel". */
  appId: string;
  /** localStorage key that gates access once a subscription is verified, e.g. "harborsentinel_access". */
  accessStorageKey: string;
  /** Supabase product id (tiers.product_id) that counts as an active subscription for this app. */
  productId: string;
  supabase: SupabaseClientLike;
  isConfigured: boolean;
  /** Resolves the local hardware footprint used for device-limit enforcement (desktop only; native platforms use Capacitor's Device.getId() instead). */
  fetchMachineId: () => Promise<{ machineId: string }>;
  onAuthenticated: () => void;
  /** If set, any value under this old localStorage key is migrated to accessStorageKey on mount. */
  legacyStorageKey?: string;
  /** If true, shows "Run Offline (Local-Only Mode)" buttons that bypass auth entirely by calling onAuthenticated. */
  allowOfflineMode?: boolean;
}

async function resolveDeviceIdentity(fetchMachineId: () => Promise<{ machineId: string }>) {
  if (Capacitor.isNativePlatform()) {
    const info = await Device.getId();
    const platformName = Capacitor.getPlatform() === 'ios' ? 'iOS Phone/Tablet' : 'Android Phone/Tablet';
    return { machineId: info.identifier, platformName };
  }
  const { machineId } = await fetchMachineId();
  const platform = navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('Mac') ? 'Mac' : 'Linux';
  return { machineId, platformName: `${platform} Desktop` };
}

export function AuthScreen({
  appName,
  appId,
  accessStorageKey,
  productId,
  supabase,
  isConfigured,
  fetchMachineId,
  onAuthenticated,
  legacyStorageKey,
  allowOfflineMode = false
}: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [hasNoSubscription, setHasNoSubscription] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!legacyStorageKey) return;
    const oldValue = localStorage.getItem(legacyStorageKey);
    if (oldValue !== null) {
      localStorage.setItem(accessStorageKey, oldValue);
      localStorage.removeItem(legacyStorageKey);
    }
    // Runs once on mount with the initial config; apps pass stable literals for these keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Without real credentials, supabase.auth calls would silently hit a
    // placeholder and fail with an opaque network error.
    // Skip straight to the "not configured" screen instead.
    if (!isConfigured) {
      setChecking(false);
      return;
    }

    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkAccess(session.user.id);
      } else {
        setChecking(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkAccess(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem(accessStorageKey);
        setHasNoSubscription(false);
        setChecking(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background polling for active subscription
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    if (hasNoSubscription) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          intervalId = setInterval(() => {
            checkAccessSilent(session.user.id);
          }, 5000);
        }
      });
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNoSubscription]);

  const hasActiveSubscription = async (userId: string): Promise<boolean> => {
    let hasAccess = false;

    const { data: subs } = await supabase
      .from('user_subscriptions')
      .select('*, tiers(product_id)')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (subs) {
      hasAccess = subs.some((s: any) => s.tiers?.product_id === productId);
    }

    if (!hasAccess) {
      const { data: userBundles } = await supabase
        .from('user_bundles')
        .select('bundle_tier_id')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (userBundles && userBundles.length > 0) {
        const bundleTierIds = userBundles.map((b: any) => b.bundle_tier_id);
        const { data: mappings } = await supabase
          .from('bundle_tier_mappings')
          .select('product_tier_id, tiers!inner(product_id)')
          .in('bundle_tier_id', bundleTierIds);

        if (mappings) {
          hasAccess = mappings.some((m: any) => m.tiers?.product_id === productId);
        }
      }
    }

    return hasAccess;
  };

  // Silent check that doesn't trigger global loading spinners during polling
  const checkAccessSilent = async (userId: string) => {
    try {
      if (await hasActiveSubscription(userId)) {
        // Proceed with hardware registration
        await checkAccess(userId);
      }
    } catch (e) {
      console.error('Silent subscription check failed:', e);
    }
  };

  const checkAccess = async (userId: string) => {
    try {
      const hasAccess = await hasActiveSubscription(userId);

      if (hasAccess) {
        // Enforce hardware device limits
        try {
          const { machineId, platformName } = await resolveDeviceIdentity(fetchMachineId);

          // Check if this hardware is already registered
          const { data: existingDevice, error: devError } = await supabase
            .from('devices')
            .select('id')
            .eq('user_id', userId)
            .eq('device_identifier', machineId)
            .maybeSingle();

          if (devError) throw devError;

          if (existingDevice) {
            await supabase
              .from('devices')
              .update({ last_active_at: new Date().toISOString() })
              .eq('id', existingDevice.id);
          } else {
            const { data: limits, error: limitErr } = await supabase.rpc('get_user_device_limits');
            if (limitErr) throw limitErr;

            if (limits && limits.length > 0) {
              const { active_devices, max_devices } = limits[0];
              if (active_devices >= max_devices) {
                setError(`Device limit reached. You are using ${active_devices} of ${max_devices} slots. Please revoke a device from the Admin Dashboard to register this machine.`);
                setHasNoSubscription(false);
                setChecking(false);
                return;
              }
            }

            const { error: insErr } = await supabase
              .from('devices')
              .insert({
                user_id: userId,
                device_identifier: machineId,
                device_name: platformName
              });

            if (insErr) throw insErr;
          }
        } catch (deviceErr: any) {
          console.error('Hardware verification failed:', deviceErr);
          if (localStorage.getItem(accessStorageKey) !== 'true') {
            setError(`Device verification failed: ${deviceErr.message || deviceErr}. Please check your connection.`);
            setChecking(false);
            return;
          }
        }

        localStorage.setItem(accessStorageKey, 'true');
        onAuthenticated();
      } else {
        setHasNoSubscription(true);
        setChecking(false);
      }
    } catch (err) {
      console.error(err);
      if (localStorage.getItem(accessStorageKey) === 'true') {
        onAuthenticated();
      } else {
        setError('Network error checking subscription status. Please connect to internet to verify your license.');
        setChecking(false);
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const defaultName = email.split('@')[0];
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: defaultName
          }
        }
      });

      if (error) throw error;

      const session = data?.session;
      if (session) {
        await checkAccess(session.user.id);
      } else {
        alert('Account registered successfully! Please sign in using your credentials.');
        setIsRegistering(false);
        setError('Registration successful! Please sign in.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to register account.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    localStorage.removeItem(accessStorageKey);
    setHasNoSubscription(false);
    setError('');
    setLoading(false);
  };

  const triggerManualCheck = async () => {
    setLoading(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await checkAccess(session.user.id);
    }
    setLoading(false);
  };

  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-bg-panel flex items-center justify-center text-text-primary p-4">
        <div className="max-w-md w-full bg-bg-card rounded-xl border border-border-color shadow-2xl p-8 space-y-4 text-center">
          <div className="mx-auto bg-red/20 w-16 h-16 rounded-full flex items-center justify-center border border-red/50">
            <AlertTriangle className="w-8 h-8 text-red" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-wide">Sign-In Unavailable</h1>
          <p className="text-sm text-text-secondary">
            {appId} isn't connected to Supabase, so sign-in and licensing can't be verified.
            Set <code className="text-text-secondary">SUPABASE_URL</code> and <code className="text-text-secondary">SUPABASE_ANON_KEY</code> (see <code className="text-text-secondary">.env.example</code>) and restart the app.
          </p>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-bg-panel flex items-center justify-center text-text-primary">
        <div className="flex flex-col items-center gap-4">
          <Anchor className="w-12 h-12 text-cyan animate-pulse" />
          <h2 className="text-xl font-bold">Verifying Sentinel License...</h2>
        </div>
      </div>
    );
  }

  // Render friendly block screen if account exists but lacks subscription
  if (hasNoSubscription) {
    return (
      <div className="min-h-screen bg-bg-panel flex items-center justify-center text-text-primary p-4">
        <div className="max-w-md w-full bg-bg-card rounded-xl border border-border-color shadow-2xl p-8 space-y-6">
          <div className="text-center">
            <div className="mx-auto bg-warning/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 border border-warning/50 shadow-[0_0_15px_var(--color-warning-glow)]">
              <AlertTriangle className="w-8 h-8 text-warning" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary tracking-wide">Account Active</h1>
            <p className="text-sm text-text-secondary mt-2">No active {appName} subscription found.</p>
          </div>

          <div className="bg-bg-panel/60 p-4 rounded-xl border border-border-color/50 text-xs text-text-secondary leading-relaxed space-y-3">
            <p className="font-semibold text-text-primary">To activate this device and unlock access:</p>
            <ol className="list-decimal pl-4 space-y-2">
              <li>Open your web browser and visit <strong className="text-cyan">marinersentinel.com</strong>.</li>
              <li>Sign in using your registered email: <strong>{email}</strong>.</li>
              <li>Choose a subscription plan and complete checkout.</li>
            </ol>
            <p className="text-[11px] text-text-muted italic mt-2 animate-pulse">
              This app will detect your payment and unlock automatically in the background...
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <button
                onClick={triggerManualCheck}
                disabled={loading}
                className="flex-1 bg-cyan hover:bg-cyan text-bg-app font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Checking...' : 'Check Again'}
              </button>
              <button
                onClick={handleSignOut}
                disabled={loading}
                className="px-4 py-3 bg-bg-card-hover hover:bg-bg-highest text-text-primary font-bold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>

            {allowOfflineMode && (
              <>
                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-border-color"></div>
                  <span className="flex-shrink mx-4 text-text-muted text-[11px] font-semibold uppercase tracking-wider">or</span>
                  <div className="flex-grow border-t border-border-color"></div>
                </div>

                <button
                  onClick={onAuthenticated}
                  className="w-full bg-bg-card-hover hover:bg-bg-card-hover text-text-secondary font-semibold py-2.5 px-4 rounded-lg transition-all border border-border-color text-xs"
                >
                  Run Offline (Local-Only Mode)
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-panel flex items-center justify-center text-text-primary p-4">
      <div className="max-w-md w-full bg-bg-card rounded-xl border border-border-color shadow-2xl overflow-hidden">
        <div className="p-8 text-center bg-bg-card border-b border-border-color">
          <div className="mx-auto bg-cyan/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 border border-cyan/50 shadow-[0_0_15px_var(--color-cyan-glow)]">
            <ShieldCheck className="w-8 h-8 text-cyan" />
          </div>
          <h1 className="text-2xl font-heading font-semibold text-text-primary">{appName}</h1>
          <p className="text-sm text-text-secondary mt-2">
            {isRegistering ? 'Create your credentials for free' : 'Sign in to continue'}
          </p>
        </div>

        <form onSubmit={isRegistering ? handleSignUp : handleLogin} className="p-8 space-y-6">
          {error && (
            <div className="bg-red/10 border border-red/50 p-4 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red shrink-0 mt-0.5" />
              <p className="text-sm text-red">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-bg-panel border border-border-color rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan transition-colors"
                placeholder="captain@vessel.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-bg-panel border border-border-color rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div className="space-y-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan hover:bg-cyan text-bg-app font-bold py-3 px-4 rounded-lg transition-all shadow-[0_0_20px_var(--color-cyan-glow)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : isRegistering ? 'Register Account' : 'Sign In'}
            </button>

            {isRegistering && (
              <p className="text-[11px] text-text-secondary text-center leading-relaxed px-4">
                Billing setup is handled externally on our website. Creating an account registers your credentials.
              </p>
            )}

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setError('');
                }}
                className="text-xs font-semibold text-cyan hover:text-cyan transition-colors"
              >
                {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
              </button>
            </div>

            {allowOfflineMode && (
              <>
                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-border-color"></div>
                  <span className="flex-shrink mx-4 text-text-muted text-xs font-semibold uppercase tracking-wider">or</span>
                  <div className="flex-grow border-t border-border-color"></div>
                </div>

                <button
                  type="button"
                  onClick={onAuthenticated}
                  className="w-full bg-bg-card-hover hover:bg-bg-highest text-text-primary font-semibold py-2.5 px-4 rounded-lg transition-all border border-border-color cursor-pointer text-sm"
                >
                  Run Offline (Local-Only Mode)
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
