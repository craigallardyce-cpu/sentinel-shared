import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Anchor, ShieldCheck, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
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
export function AuthScreen({ appName, appId, accessStorageKey, productId, supabase, isConfigured, fetchMachineId, onAuthenticated, legacyStorageKey, allowOfflineMode = false }) {
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
            }
            else {
                setChecking(false);
            }
        });
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                checkAccess(session.user.id);
            }
            else if (event === 'SIGNED_OUT') {
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
    const hasActiveSubscription = async (userId) => {
        let hasAccess = false;
        const { data: subs } = await supabase
            .from('user_subscriptions')
            .select('*, tiers(product_id)')
            .eq('user_id', userId)
            .eq('status', 'active');
        if (subs) {
            hasAccess = subs.some((s) => s.tiers?.product_id === productId);
        }
        if (!hasAccess) {
            const { data: userBundles } = await supabase
                .from('user_bundles')
                .select('bundle_tier_id')
                .eq('user_id', userId)
                .eq('status', 'active');
            if (userBundles && userBundles.length > 0) {
                const bundleTierIds = userBundles.map((b) => b.bundle_tier_id);
                const { data: mappings } = await supabase
                    .from('bundle_tier_mappings')
                    .select('product_tier_id, tiers!inner(product_id)')
                    .in('bundle_tier_id', bundleTierIds);
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
                    if (localStorage.getItem(accessStorageKey) !== 'true') {
                        setError(`Device verification failed: ${deviceErr.message || deviceErr}. Please check your connection.`);
                        setChecking(false);
                        return;
                    }
                }
                localStorage.setItem(accessStorageKey, 'true');
                onAuthenticated();
            }
            else {
                setHasNoSubscription(true);
                setChecking(false);
            }
        }
        catch (err) {
            console.error(err);
            if (localStorage.getItem(accessStorageKey) === 'true') {
                onAuthenticated();
            }
            else {
                setError('Network error checking subscription status. Please connect to internet to verify your license.');
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
        return (_jsx("div", { className: "min-h-screen bg-slate-900 flex items-center justify-center text-slate-200 p-4", children: _jsxs("div", { className: "max-w-md w-full bg-slate-800 rounded-xl border border-slate-700 shadow-2xl p-8 space-y-4 text-center", children: [_jsx("div", { className: "mx-auto bg-red-500/20 w-16 h-16 rounded-full flex items-center justify-center border border-red-500/50", children: _jsx(AlertTriangle, { className: "w-8 h-8 text-red-400" }) }), _jsx("h1", { className: "text-2xl font-bold text-white tracking-wide", children: "Sign-In Unavailable" }), _jsxs("p", { className: "text-sm text-slate-400", children: [appId, " isn't connected to Supabase, so sign-in and licensing can't be verified. Set ", _jsx("code", { className: "text-slate-300", children: "SUPABASE_URL" }), " and ", _jsx("code", { className: "text-slate-300", children: "SUPABASE_ANON_KEY" }), " (see ", _jsx("code", { className: "text-slate-300", children: ".env.example" }), ") and restart the app."] })] }) }));
    }
    if (checking) {
        return (_jsx("div", { className: "min-h-screen bg-slate-900 flex items-center justify-center text-white", children: _jsxs("div", { className: "flex flex-col items-center gap-4", children: [_jsx(Anchor, { className: "w-12 h-12 text-blue-500 animate-pulse" }), _jsx("h2", { className: "text-xl font-bold", children: "Verifying Sentinel License..." })] }) }));
    }
    // Render friendly block screen if account exists but lacks subscription
    if (hasNoSubscription) {
        return (_jsx("div", { className: "min-h-screen bg-slate-900 flex items-center justify-center text-slate-200 p-4", children: _jsxs("div", { className: "max-w-md w-full bg-slate-800 rounded-xl border border-slate-700 shadow-2xl p-8 space-y-6", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "mx-auto bg-amber-500/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]", children: _jsx(AlertTriangle, { className: "w-8 h-8 text-amber-400" }) }), _jsx("h1", { className: "text-2xl font-bold text-white tracking-wide", children: "Account Active" }), _jsxs("p", { className: "text-sm text-slate-400 mt-2", children: ["No active ", appName, " subscription found."] })] }), _jsxs("div", { className: "bg-slate-900/60 p-4 rounded-xl border border-slate-700/50 text-xs text-slate-300 leading-relaxed space-y-3", children: [_jsx("p", { className: "font-semibold text-white", children: "To activate this device and unlock access:" }), _jsxs("ol", { className: "list-decimal pl-4 space-y-2", children: [_jsxs("li", { children: ["Open your web browser and visit ", _jsx("strong", { className: "text-blue-400", children: "marinersentinel.com" }), "."] }), _jsxs("li", { children: ["Sign in using your registered email: ", _jsx("strong", { children: email }), "."] }), _jsx("li", { children: "Choose a subscription plan and complete checkout." })] }), _jsx("p", { className: "text-[10px] text-slate-500 italic mt-2 animate-pulse", children: "This app will detect your payment and unlock automatically in the background..." })] }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex gap-3", children: [_jsxs("button", { onClick: triggerManualCheck, disabled: loading, className: "flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50", children: [_jsx(RefreshCw, { className: `w-4 h-4 ${loading ? 'animate-spin' : ''}` }), loading ? 'Checking...' : 'Check Again'] }), _jsxs("button", { onClick: handleSignOut, disabled: loading, className: "px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50", children: [_jsx(LogOut, { className: "w-4 h-4" }), "Sign Out"] })] }), allowOfflineMode && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "relative flex py-1 items-center", children: [_jsx("div", { className: "flex-grow border-t border-slate-700" }), _jsx("span", { className: "flex-shrink mx-4 text-slate-500 text-[10px] font-semibold uppercase tracking-wider", children: "or" }), _jsx("div", { className: "flex-grow border-t border-slate-700" })] }), _jsx("button", { onClick: onAuthenticated, className: "w-full bg-slate-750 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-lg transition-all border border-slate-700 text-xs", children: "Run Offline (Local-Only Mode)" })] }))] })] }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-slate-900 flex items-center justify-center text-slate-200 p-4", children: _jsxs("div", { className: "max-w-md w-full bg-slate-800 rounded-xl border border-slate-700 shadow-2xl overflow-hidden", children: [_jsxs("div", { className: "p-8 text-center bg-slate-800 border-b border-slate-700", children: [_jsx("div", { className: "mx-auto bg-blue-500/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.5)]", children: _jsx(ShieldCheck, { className: "w-8 h-8 text-blue-400" }) }), _jsx("h1", { className: "text-2xl font-bold text-white tracking-wide", children: "Mariner Sentinel Suite" }), _jsx("p", { className: "text-sm text-slate-400 mt-2", children: isRegistering ? 'Create your credentials for free' : `Sign in to access ${appName}` })] }), _jsxs("form", { onSubmit: isRegistering ? handleSignUp : handleLogin, className: "p-8 space-y-6", children: [error && (_jsxs("div", { className: "bg-red-500/10 border border-red-500/50 p-4 rounded-lg flex items-start gap-3", children: [_jsx(AlertTriangle, { className: "w-5 h-5 text-red-400 shrink-0 mt-0.5" }), _jsx("p", { className: "text-sm text-red-200", children: error })] })), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2", children: "Email" }), _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors", placeholder: "captain@vessel.com", required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("button", { type: "submit", disabled: loading, className: "w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_25px_rgba(59,130,246,0.6)] disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Processing...' : isRegistering ? 'Register Account' : 'Sign In' }), isRegistering && (_jsx("p", { className: "text-[10px] text-slate-400 text-center leading-relaxed px-4", children: "Billing setup is handled externally on our website. Creating an account registers your credentials." })), _jsx("div", { className: "text-center pt-2", children: _jsx("button", { type: "button", onClick: () => {
                                            setIsRegistering(!isRegistering);
                                            setError('');
                                        }, className: "text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors", children: isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Create one" }) }), allowOfflineMode && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "relative flex py-2 items-center", children: [_jsx("div", { className: "flex-grow border-t border-slate-700" }), _jsx("span", { className: "flex-shrink mx-4 text-slate-500 text-xs font-semibold uppercase tracking-wider", children: "or" }), _jsx("div", { className: "flex-grow border-t border-slate-700" })] }), _jsx("button", { type: "button", onClick: onAuthenticated, className: "w-full bg-slate-700 hover:bg-slate-650 text-slate-200 font-semibold py-2.5 px-4 rounded-lg transition-all border border-slate-600 cursor-pointer text-sm", children: "Run Offline (Local-Only Mode)" })] }))] })] })] }) }));
}
