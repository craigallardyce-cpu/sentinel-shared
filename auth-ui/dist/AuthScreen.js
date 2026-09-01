import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Anchor, ShieldCheck, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { refreshEntitlements, clearEntitlements } from './entitlements';
const DAY_MS = 24 * 60 * 60 * 1000;
function readOfflineGrant(storage, accessStorageKey) {
    try {
        const raw = storage.getItem(`${accessStorageKey}_offline_grant`);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.userId !== 'string' || typeof parsed?.grantedAt !== 'number')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function writeOfflineGrant(storage, accessStorageKey, userId) {
    try {
        storage.setItem(`${accessStorageKey}_offline_grant`, JSON.stringify({ userId, grantedAt: Date.now() }));
    }
    catch {
        // Storage unavailable or full. The grant is an optimisation; losing it only means
        // the user must be online next launch.
    }
}
function clearOfflineGrant(storage, accessStorageKey) {
    try {
        storage.removeItem(`${accessStorageKey}_offline_grant`);
    }
    catch {
        /* ignore */
    }
}
/**
 * Whole days left on the offline grant, or 0 if there is none or it has lapsed.
 * Exported so apps can show the remaining allowance alongside their offline indicator.
 */
export function offlineGraceRemaining(storage, accessStorageKey, offlineGraceDays) {
    if (offlineGraceDays <= 0)
        return 0;
    const grant = readOfflineGrant(storage, accessStorageKey);
    if (!grant)
        return 0;
    const elapsedDays = (Date.now() - grant.grantedAt) / DAY_MS;
    return Math.max(0, Math.ceil(offlineGraceDays - elapsedDays));
}
/**
 * True when getSession() came back empty because the network was unreachable, rather
 * than because the session is genuinely gone.
 *
 * auth-js reports a network failure as AuthRetryableFetchError and deliberately leaves
 * the stored session -- refresh token included -- in place, so reconnecting recovers it.
 * A revoked or invalid refresh token is a different, non-retryable error and clears
 * storage; that user signs in again, grant or no grant. Conflating the two would let a
 * revoked device keep working for the whole grace period.
 */
function isOfflineFailure(error) {
    if (!error)
        return false;
    return (error.name === 'AuthRetryableFetchError' ||
        error.status === 0 ||
        /failed to fetch|network|offline/i.test(String(error.message || '')));
}
async function resolveDeviceIdentity(fetchMachineId) {
    if (Capacitor.isNativePlatform()) {
        const info = await Device.getId();
        const platformName = Capacitor.getPlatform() === 'ios' ? 'iOS Phone/Tablet' : 'Android Phone/Tablet';
        return { machineId: info.identifier, platformName };
    }
    const { machineId } = await fetchMachineId();
    const platform = navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('Mac') ? 'Mac' : 'Linux';
    return { machineId, platformName: `${platform} Desktop` };
}
export function AuthScreen({ appName, appId, storage, accessStorageKey, productId, supabase, isConfigured, fetchMachineId, onAuthenticated, legacyStorageKey, allowOfflineMode = false, offlineGraceDays = 0 }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [hasNoSubscription, setHasNoSubscription] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(true);
    useEffect(() => {
        if (!legacyStorageKey)
            return;
        const oldValue = storage.getItem(legacyStorageKey);
        if (oldValue !== null) {
            storage.setItem(accessStorageKey, oldValue);
            storage.removeItem(legacyStorageKey);
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
        // Fast path: the browser already knows there is no network, and this device holds a
        // grant that has not lapsed. getSession() would spend a DNS or connect timeout
        // failing before reaching the same conclusion, which is dead time on the splash
        // screen every launch at sea. Admit now and let the session resolve behind the UI.
        //
        // navigator.onLine only ever short-circuits the wait -- it is not trusted as proof
        // of anything. It reports true on a LAN with no internet, and that case still falls
        // through to the real getSession() check below.
        if (offlineGraceDays > 0 && typeof navigator !== 'undefined' && !navigator.onLine) {
            const grant = readOfflineGrant(storage, accessStorageKey);
            const verifiedBefore = storage.getItem(accessStorageKey) === 'true';
            if (grant && verifiedBefore && Date.now() - grant.grantedAt < offlineGraceDays * DAY_MS) {
                onAuthenticated();
                return;
            }
        }
        // Check active session on mount
        supabase.auth.getSession().then(({ data: { session }, error }) => {
            if (session) {
                checkAccess(session.user.id);
                return;
            }
            // No session. Offline that is expected rather than meaningful: the access token
            // has outlived its lifetime and the refresh could not reach Supabase. The stored
            // refresh token is still on disk and still valid server-side, so this device is
            // not signed out -- it is merely unable to say so right now.
            if (offlineGraceDays > 0 && isOfflineFailure(error)) {
                const grant = readOfflineGrant(storage, accessStorageKey);
                const verifiedBefore = storage.getItem(accessStorageKey) === 'true';
                const withinGrace = !!grant && Date.now() - grant.grantedAt < offlineGraceDays * DAY_MS;
                if (grant && verifiedBefore && withinGrace) {
                    onAuthenticated();
                    return;
                }
                if (grant && !withinGrace) {
                    clearOfflineGrant(storage, accessStorageKey);
                    setError(`This device has been offline for more than ${offlineGraceDays} days. Connect to the internet once to continue.`);
                }
            }
            setChecking(false);
        });
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                checkAccess(session.user.id);
            }
            else if (event === 'SIGNED_OUT') {
                // A real sign-out, or a refresh token the server rejected. Either way this
                // device has to prove itself again -- drop the offline allowance with it.
                storage.removeItem(accessStorageKey);
                clearOfflineGrant(storage, accessStorageKey);
                clearEntitlements(storage, accessStorageKey);
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
        let intervalId = null;
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
            if (intervalId)
                clearInterval(intervalId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasNoSubscription]);
    /**
     * Throws if the entitlement cannot be determined; returns false only when it was
     * genuinely checked and found absent.
     *
     * This previously destructured `data` alone and discarded every `error`. A failed
     * lookup -- no network, a timeout, a permissions problem -- left `data` null, fell
     * past the guards, and returned false, which the caller cannot distinguish it from an
     * account that genuinely holds no subscription. The user was then told to go and buy
     * one.
     *
     * Worse, it defeated the offline fallback below: checkAccess only consults the cached
     * accessStorageKey flag from its catch block, and a function that returns false
     * instead of throwing never reaches it. A boat with a valid subscription and a
     * previously-verified device was shown a billing screen it could not act on, because
     * acting on it required the internet it did not have.
     *
     * Distinguishing the two is the whole point: "we could not check" keeps you working,
     * "you do not have one" does not.
     *
     * Reads the `active_user_*` views, which filter to a status of active or trialing
     * with an unexpired `current_period_end`, on the database's clock. A 30-day trial
     * therefore lapses on its own here, with no status flip to schedule.
     */
    const hasActiveSubscription = async (userId) => {
        let hasAccess = false;
        const { data: subs, error: subsError } = await supabase
            .from('active_user_subscriptions')
            .select('*, tiers(product_id)')
            .eq('user_id', userId);
        if (subsError)
            throw subsError;
        if (subs) {
            hasAccess = subs.some((s) => s.tiers?.product_id === productId);
        }
        if (!hasAccess) {
            const { data: userBundles, error: bundlesError } = await supabase
                .from('active_user_bundles')
                .select('bundle_tier_id')
                .eq('user_id', userId);
            if (bundlesError)
                throw bundlesError;
            if (userBundles && userBundles.length > 0) {
                const bundleTierIds = userBundles.map((b) => b.bundle_tier_id);
                const { data: mappings, error: mappingsError } = await supabase
                    .from('bundle_tier_mappings')
                    .select('product_tier_id, tiers!inner(product_id)')
                    .in('bundle_tier_id', bundleTierIds);
                if (mappingsError)
                    throw mappingsError;
                if (mappings) {
                    hasAccess = mappings.some((m) => m.tiers?.product_id === productId);
                }
            }
        }
        return hasAccess;
    };
    // Silent check that doesn't trigger global loading spinners during polling
    const checkAccessSilent = async (userId) => {
        try {
            if (await hasActiveSubscription(userId)) {
                // Proceed with hardware registration
                await checkAccess(userId);
            }
        }
        catch (e) {
            console.error('Silent subscription check failed:', e);
        }
    };
    const checkAccess = async (userId) => {
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
                    if (devError)
                        throw devError;
                    if (existingDevice) {
                        await supabase
                            .from('devices')
                            .update({ last_active_at: new Date().toISOString() })
                            .eq('id', existingDevice.id);
                    }
                    else {
                        const { data: limits, error: limitErr } = await supabase.rpc('get_user_device_limits');
                        if (limitErr)
                            throw limitErr;
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
                        if (insErr)
                            throw insErr;
                    }
                }
                catch (deviceErr) {
                    console.error('Hardware verification failed:', deviceErr);
                    if (storage.getItem(accessStorageKey) !== 'true') {
                        setError(`Device verification failed: ${deviceErr.message || deviceErr}. Please check your connection.`);
                        setChecking(false);
                        return;
                    }
                }
                storage.setItem(accessStorageKey, 'true');
                // Refresh the cached tier entitlements alongside every online
                // verification. A failed refresh keeps the previous cache — features
                // are never taken away because a lookup did not complete.
                await refreshEntitlements(storage, supabase, userId, productId, accessStorageKey);
                // Re-stamp on every online verification, so the clock runs from the last time
                // this device actually reached Supabase rather than from first sign-in.
                if (offlineGraceDays > 0) {
                    writeOfflineGrant(storage, accessStorageKey, userId);
                }
                onAuthenticated();
            }
            else {
                setHasNoSubscription(true);
                setChecking(false);
            }
        }
        catch (err) {
            console.error(err);
            // The entitlement could not be checked -- not the same as not having one. A device
            // that has verified before keeps working, bounded by its grant when one is in use.
            const verifiedBefore = storage.getItem(accessStorageKey) === 'true';
            const grant = readOfflineGrant(storage, accessStorageKey);
            const withinGrace = offlineGraceDays > 0 && !!grant && Date.now() - grant.grantedAt < offlineGraceDays * DAY_MS;
            if (verifiedBefore && (offlineGraceDays === 0 || withinGrace)) {
                onAuthenticated();
            }
            else if (verifiedBefore && grant) {
                setError(`This device has been offline for more than ${offlineGraceDays} days. Connect to the internet once to continue.`);
                setChecking(false);
            }
            else {
                setError('Could not verify your licence. Connect to the internet and try again.');
                setChecking(false);
            }
        }
    };
    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setError(error.message);
            setLoading(false);
        }
    };
    const handleSignUp = async (e) => {
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
            if (error)
                throw error;
            const session = data?.session;
            if (session) {
                await checkAccess(session.user.id);
            }
            else {
                alert('Account registered successfully! Please sign in using your credentials.');
                setIsRegistering(false);
                setError('Registration successful! Please sign in.');
            }
        }
        catch (err) {
            setError(err.message || 'Failed to register account.');
        }
        finally {
            setLoading(false);
        }
    };
    const handleSignOut = async () => {
        setLoading(true);
        await supabase.auth.signOut();
        storage.removeItem(accessStorageKey);
        clearEntitlements(storage, accessStorageKey);
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
        return (_jsx("div", { className: "min-h-screen bg-bg-panel flex items-center justify-center text-text-primary p-4", children: _jsxs("div", { className: "max-w-md w-full bg-bg-card rounded-xl border border-border-color shadow-2xl p-8 space-y-4 text-center", children: [_jsx("div", { className: "mx-auto bg-red/20 w-16 h-16 rounded-full flex items-center justify-center border border-red/50", children: _jsx(AlertTriangle, { className: "w-8 h-8 text-red" }) }), _jsx("h1", { className: "text-2xl font-bold text-text-primary tracking-wide", children: "Sign-In Unavailable" }), _jsxs("p", { className: "text-sm text-text-secondary", children: [appId, " isn't connected to Supabase, so sign-in and licensing can't be verified. Set ", _jsx("code", { className: "text-text-secondary", children: "SUPABASE_URL" }), " and ", _jsx("code", { className: "text-text-secondary", children: "SUPABASE_ANON_KEY" }), " (see ", _jsx("code", { className: "text-text-secondary", children: ".env.example" }), ") and restart the app."] })] }) }));
    }
    if (checking) {
        return (_jsx("div", { className: "min-h-screen bg-bg-panel flex items-center justify-center text-text-primary", children: _jsxs("div", { className: "flex flex-col items-center gap-4", children: [_jsx(Anchor, { className: "w-12 h-12 text-cyan animate-pulse" }), _jsx("h2", { className: "text-xl font-bold", children: "Verifying Sentinel License..." })] }) }));
    }
    // Render friendly block screen if account exists but lacks subscription
    if (hasNoSubscription) {
        return (_jsx("div", { className: "min-h-screen bg-bg-panel flex items-center justify-center text-text-primary p-4", children: _jsxs("div", { className: "max-w-md w-full bg-bg-card rounded-xl border border-border-color shadow-2xl p-8 space-y-6", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "mx-auto bg-warning/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 border border-warning/50 shadow-[0_0_15px_var(--color-warning-glow)]", children: _jsx(AlertTriangle, { className: "w-8 h-8 text-warning" }) }), _jsx("h1", { className: "text-2xl font-bold text-text-primary tracking-wide", children: "Account Active" }), _jsxs("p", { className: "text-sm text-text-secondary mt-2", children: ["No active ", appName, " subscription found."] })] }), _jsxs("div", { className: "bg-bg-panel/60 p-4 rounded-xl border border-border-color/50 text-xs text-text-secondary leading-relaxed space-y-3", children: [_jsx("p", { className: "font-semibold text-text-primary", children: "To activate this device and unlock access:" }), _jsxs("ol", { className: "list-decimal pl-4 space-y-2", children: [_jsxs("li", { children: ["Open your web browser and visit ", _jsx("strong", { className: "text-cyan", children: "marinersentinel.com" }), "."] }), _jsxs("li", { children: ["Sign in using your registered email: ", _jsx("strong", { children: email }), "."] }), _jsx("li", { children: "Choose a subscription plan and complete checkout." })] }), _jsx("p", { className: "text-[11px] text-text-muted italic mt-2 animate-pulse", children: "This app will detect your payment and unlock automatically in the background..." })] }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex gap-3", children: [_jsxs("button", { onClick: triggerManualCheck, disabled: loading, className: "flex-1 bg-cyan hover:bg-cyan text-bg-app font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50", children: [_jsx(RefreshCw, { className: `w-4 h-4 ${loading ? 'animate-spin' : ''}` }), loading ? 'Checking...' : 'Check Again'] }), _jsxs("button", { onClick: handleSignOut, disabled: loading, className: "px-4 py-3 bg-bg-card-hover hover:bg-bg-highest text-text-primary font-bold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50", children: [_jsx(LogOut, { className: "w-4 h-4" }), "Sign Out"] })] }), allowOfflineMode && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "relative flex py-1 items-center", children: [_jsx("div", { className: "flex-grow border-t border-border-color" }), _jsx("span", { className: "flex-shrink mx-4 text-text-muted text-[11px] font-semibold uppercase tracking-wider", children: "or" }), _jsx("div", { className: "flex-grow border-t border-border-color" })] }), _jsx("button", { onClick: onAuthenticated, className: "w-full bg-bg-card-hover hover:bg-bg-card-hover text-text-secondary font-semibold py-2.5 px-4 rounded-lg transition-all border border-border-color text-xs", children: "Run Offline (Local-Only Mode)" })] }))] })] }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-bg-panel flex items-center justify-center text-text-primary p-4", children: _jsxs("div", { className: "max-w-md w-full bg-bg-card rounded-xl border border-border-color shadow-2xl overflow-hidden", children: [_jsxs("div", { className: "p-8 text-center bg-bg-card border-b border-border-color", children: [_jsx("div", { className: "mx-auto bg-cyan/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 border border-cyan/50 shadow-[0_0_15px_var(--color-cyan-glow)]", children: _jsx(ShieldCheck, { className: "w-8 h-8 text-cyan" }) }), _jsx("h1", { className: "text-2xl font-heading font-semibold text-text-primary", children: appName }), _jsx("p", { className: "text-sm text-text-secondary mt-2", children: isRegistering ? 'Create your credentials for free' : 'Sign in to continue' })] }), _jsxs("form", { onSubmit: isRegistering ? handleSignUp : handleLogin, className: "p-8 space-y-6", children: [error && (_jsxs("div", { className: "bg-red/10 border border-red/50 p-4 rounded-lg flex items-start gap-3", children: [_jsx(AlertTriangle, { className: "w-5 h-5 text-red shrink-0 mt-0.5" }), _jsx("p", { className: "text-sm text-red", children: error })] })), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2", children: "Email" }), _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), className: "w-full bg-bg-panel border border-border-color rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan transition-colors", placeholder: "captain@vessel.com", required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), className: "w-full bg-bg-panel border border-border-color rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan transition-colors", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("button", { type: "submit", disabled: loading, className: "w-full bg-cyan hover:bg-cyan text-bg-app font-bold py-3 px-4 rounded-lg transition-all shadow-[0_0_20px_var(--color-cyan-glow)] disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Processing...' : isRegistering ? 'Register Account' : 'Sign In' }), isRegistering && (_jsx("p", { className: "text-[11px] text-text-secondary text-center leading-relaxed px-4", children: "Billing setup is handled externally on our website. Creating an account registers your credentials." })), _jsx("div", { className: "text-center pt-2", children: _jsx("button", { type: "button", onClick: () => {
                                            setIsRegistering(!isRegistering);
                                            setError('');
                                        }, className: "text-xs font-semibold text-cyan hover:text-cyan transition-colors", children: isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Create one" }) }), allowOfflineMode && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "relative flex py-2 items-center", children: [_jsx("div", { className: "flex-grow border-t border-border-color" }), _jsx("span", { className: "flex-shrink mx-4 text-text-muted text-xs font-semibold uppercase tracking-wider", children: "or" }), _jsx("div", { className: "flex-grow border-t border-border-color" })] }), _jsx("button", { type: "button", onClick: onAuthenticated, className: "w-full bg-bg-card-hover hover:bg-bg-highest text-text-primary font-semibold py-2.5 px-4 rounded-lg transition-all border border-border-color cursor-pointer text-sm", children: "Run Offline (Local-Only Mode)" })] }))] })] })] }) }));
}
