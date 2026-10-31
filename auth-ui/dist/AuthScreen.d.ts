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
    /**
     * Reads this computer's hardware id from the app's own backend, for the device
     * limit. Called only when the page was loaded from this computer (the desktop
     * app, or a browser on the boat computer); native uses Device.getId() and a
     * browser elsewhere on the LAN gets an id of its own (deviceIdentity.ts).
     */
    fetchMachineId: () => Promise<{
        machineId: string;
    }>;
    onAuthenticated: () => void;
    /**
     * A feature key this product needs in order to be useful on a desktop.
     * When set and the app is running on a desktop, an account whose tier does not
     * grant it is refused BEFORE a device slot is consumed. Omitted by products
     * that work fine on a desktop (VesselKeeper), so they are unaffected.
     */
    desktopRequiresFeature?: string;
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
 * The website's Delete account dialog, the same address each app's Settings
 * links to. Google Play requires a way to delete the account from inside the
 * app, and someone whose plan has ended never reaches Settings: this screen is
 * all they see, so it offers the link too.
 */
export declare const DELETE_ACCOUNT_URL = "https://marinersentinel.com/account#delete-account";
/** The sign-up confirmation, worded as the Privacy Policy's section 11 sets the age. */
export declare const AGE_CONFIRMATION_LABEL = "I'm 18 or older, or the age of majority where I live if that is higher.";
export declare const AGE_REQUIRED_MESSAGE = "To create an account, confirm that you are 18 or older, or the age of majority where you live.";
/**
 * Whole days left on the offline grant, or 0 if there is none or it has lapsed.
 * Exported so apps can show the remaining allowance alongside their offline indicator.
 */
export declare function offlineGraceRemaining(storage: StorageLike, accessStorageKey: string, offlineGraceDays: number): number;
export declare function AuthScreen({ appName, appId, storage, accessStorageKey, productId, supabase, isConfigured, fetchMachineId, onAuthenticated, desktopRequiresFeature, legacyStorageKey, allowOfflineMode, offlineGraceDays }: AuthScreenProps): React.JSX.Element;
