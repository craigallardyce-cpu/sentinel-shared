import type { StorageLike } from './storage';
import React from 'react';
/**
 * Structural (not imported) subset of Supabase's SupabaseClient — avoids a
 * nominal-typing mismatch when this package's own installed copy of
 * @supabase/supabase-js differs from the consuming app's copy (each app's
 * `supabase` instance still satisfies this shape at runtime either way).
 */
export interface SupabaseClientLike {
    auth: {
        getSession(): Promise<{
            data: {
                session: any;
            };
            error?: any;
        }>;
        onAuthStateChange(callback: (event: string, session: any) => void): {
            data: {
                subscription: {
                    unsubscribe: () => void;
                };
            };
        };
        signInWithPassword(credentials: {
            email: string;
            password: string;
        }): Promise<{
            error: any;
        }>;
        signUp(params: any): Promise<{
            data: any;
            error: any;
        }>;
        signOut(): Promise<{
            error: any;
        }>;
    };
    from(table: string): any;
    rpc(fn: string, args?: any): PromiseLike<{
        data: any;
        error: any;
    }>;
}
export interface AuthScreenProps {
    /**
     * Where the access flag, the offline grant and the entitlement cache live.
     *
     * Required rather than defaulted to the browser global: this package is
     * installed by three apps and one of them runs its server in the same process,
     * and the keys built from `accessStorageKey` are invisible to every check the
     * fleet has unless the app that owns the storage hands it over. Pass
     * `browserStorage()` from `@sentinel/settings` unless there is a reason not to.
     */
    storage: StorageLike;
    /** Two-word product name used in copy, e.g. "Harbor Sentinel". */
    appName: string;
    /** One-word app id used in the "not connected to Supabase" message, e.g. "HarborSentinel". */
    appId: string;
    /** Storage key that gates access once a subscription is verified, e.g. "harborsentinel_access". */
    accessStorageKey: string;
    /** Supabase product id (tiers.product_id) that counts as an active subscription for this app. */
    productId: string;
    supabase: SupabaseClientLike;
    isConfigured: boolean;
    /** Resolves the local hardware footprint used for device-limit enforcement (desktop only; native platforms use Capacitor's Device.getId() instead). */
    fetchMachineId: () => Promise<{
        machineId: string;
    }>;
    onAuthenticated: () => void;
    /** If set, any value under this old key is migrated to accessStorageKey on mount. */
    legacyStorageKey?: string;
    /** If true, shows "Run Offline (Local-Only Mode)" buttons that bypass auth entirely by calling onAuthenticated. */
    allowOfflineMode?: boolean;
    /**
     * How many days a device that has already verified online may keep running with no
     * reachable Supabase. 0 (the default) preserves the previous behaviour: once the
     * access token expires offline, the sign-in screen comes back.
     *
     * These are boat apps, and that default is wrong for them. `getSession()` returns the
     * stored session only while the access token is inside its lifetime; past that it
     * attempts a refresh, which offline fails, so it returns `session: null` and the user
     * is locked out of data sitting on their own disk. A passage outlasts any token
     * Supabase will issue -- 7 days is the ceiling.
     *
     * Safe to grant because offline reads come from the local cache and writes go to the
     * outbox: nothing reaches the database without a live token, so RLS is untouched.
     * This gate is a licensing decision, not a security boundary.
     */
    offlineGraceDays?: number;
}
/**
 * Whole days left on the offline grant, or 0 if there is none or it has lapsed.
 * Exported so apps can show the remaining allowance alongside their offline indicator.
 */
export declare function offlineGraceRemaining(storage: StorageLike, accessStorageKey: string, offlineGraceDays: number): number;
export declare function AuthScreen({ appName, appId, storage, accessStorageKey, productId, supabase, isConfigured, fetchMachineId, onAuthenticated, legacyStorageKey, allowOfflineMode, offlineGraceDays }: AuthScreenProps): React.JSX.Element;
