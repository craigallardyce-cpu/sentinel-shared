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
        signOut(options?: {
            scope?: 'global' | 'local' | 'others';
        }): Promise<{
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
    /**
     * The app's own glyph, drawn above its name on the sign-in and sign-up form
     * and on the licence check: the same element the app gives `AppShell` as
     * `brandIcon` (HarborSentinel's anchor, OceanSentinel's waves, VesselKeeper's
     * shield). Sized by this screen, so pass it unsized.
     *
     * There is deliberately no default. This screen used to draw VesselKeeper's
     * shield for every app (and HarborSentinel's anchor on the licence check), so
     * OceanSentinel's sign-in wore VesselKeeper's mark. An app that passes nothing
     * gets no glyph rather than another app's.
     */
    brandIcon?: React.ReactNode;
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
    /**
     * The Terms version sign-up asks the person to agree to. Defaults to
     * `TERMS_VERSION`, which is what every app should use; a test passes one to
     * see the box before the Terms are published. Null shows no box.
     */
    termsVersion?: string | null;
    /**
     * Called once each time this screen sees the account's session end: the Sign
     * Out button on the no-plan screen, a sign-out made elsewhere, or a refresh
     * token the server rejected. By then the access flag, the offline grant and
     * the entitlement cache are already cleared.
     *
     * It is where an app drops what it holds for that account on this device: a
     * local cache, an outbox of queued writes, a settings store. Without it the
     * next account to sign in on the device starts with the previous one's data
     * (VesselKeeper review M1). The screen does not wait for it, so it may be
     * async and may call Supabase.
     *
     * This screen is only mounted until sign-in succeeds. `watchForSignOut` is
     * the same thing for the rest of the session.
     */
    onSignedOut?: () => void | Promise<void>;
}
/**
 * The website's Delete account dialog, the same address each app's Settings
 * links to. Google Play requires a way to delete the account from inside the
 * app, and someone whose plan has ended never reaches Settings: this screen is
 * all they see, so it offers the link too.
 */
export declare const DELETE_ACCOUNT_URL = "https://marinersentinel.com/account#delete-account";
/**
 * Where "Forgot your password?" on the sign-in form goes: the website's Account
 * page, whose own sign-in form has the same link and emails a reset link. The
 * apps' Supabase client has no page to land a reset link on, so the reset stays
 * on the website. `#sign-in` opens that page on its sign-in form with the email
 * field, and the reset link under it, in view (website AccountView). A site
 * without it still opens the Account page.
 */
export declare const PASSWORD_RESET_URL = "https://marinersentinel.com/account#sign-in";
/** The sign-up confirmation, worded as the Privacy Policy's section 11 sets the age. */
export declare const AGE_CONFIRMATION_LABEL = "I'm 18 or older, or the age of majority where I live if that is higher.";
export declare const AGE_REQUIRED_MESSAGE = "To create an account, confirm that you are 18 or older, or the age of majority where you live.";
/** The two documents the sign-up agreement links to, on the website. */
export declare const TERMS_URL = "https://marinersentinel.com/terms";
export declare const PRIVACY_URL = "https://marinersentinel.com/privacy";
/**
 * The Terms of Service in force, named by the "last updated" date at the top of
 * the published Terms, and recorded on the account beside the time it was
 * agreed to (`terms_version`, `terms_accepted_at` in its user metadata).
 *
 * `null` until the Terms are published, and while it is null sign-up shows no
 * agreement box: the website's /terms page is still an outline that says no
 * terms are in force, and agreeing to it would mean nothing (Terms TD10;
 * docs-kb ROADMAP, "I agree to the Terms of Service and Privacy Policy").
 * Publishing the Terms sets this to their date, in the same change as the
 * website's `TERMS_VERSION` in `src/content/flags.ts`, and every later material
 * change to the Terms moves both. Apps pick it up at the next release's pin bump.
 */
export declare const TERMS_VERSION: string | null;
export declare const TERMS_AGREEMENT_LABEL = "I agree to the Terms of Service and Privacy Policy.";
export declare const TERMS_REQUIRED_MESSAGE = "To create an account, agree to the Terms of Service and Privacy Policy.";
export interface WatchForSignOutOptions {
    storage: StorageLike;
    accessStorageKey: string;
    /** Called each time the session ends. Not awaited; may be async and may call Supabase. */
    onSignedOut: () => void | Promise<void>;
}
/**
 * Hear the session end after sign-in.
 *
 * `AuthScreen` listens for a sign-out only while it is on screen, and an app
 * takes it down the moment sign-in succeeds. From then on a session that was
 * revoked, or whose refresh token the server rejected, ended with nobody
 * listening: the app stayed open, every request failed, and queued edits were
 * sent with no session (VesselKeeper review M4).
 *
 * Call this when `onAuthenticated` fires and keep it for as long as the app is
 * open. On `SIGNED_OUT` it clears the access flag, the offline grant and the
 * entitlement cache, exactly as the screen does, then calls `onSignedOut`,
 * where the app drops that account's local data and shows the sign-in screen
 * again. Being offline is not a sign-out: auth-js keeps the stored session when
 * a refresh cannot reach the server, and no event fires.
 *
 * Returns the function that stops listening.
 */
export declare function watchForSignOut(supabase: SupabaseClientLike, options: WatchForSignOutOptions): () => void;
/**
 * Whole days left on the offline grant, or 0 if there is none or it has lapsed.
 * Exported so apps can show the remaining allowance alongside their offline indicator.
 */
export declare function offlineGraceRemaining(storage: StorageLike, accessStorageKey: string, offlineGraceDays: number): number;
/**
 * The account an offline start was admitted as, or null.
 *
 * An offline start is admitted with no session at all: `getSession()` returns
 * none once the access token has outlived its lifetime and the refresh cannot
 * reach Supabase. An app that keys anything by account (its account settings
 * layer, a cache) was left treating that start as nobody, so account-scoped
 * settings read as defaults until the next online start (OceanSentinel review
 * M3). This answers who, by the rule this screen admits on, so no app keeps a
 * second copy of it:
 *
 * - `offlineGraceDays` is above zero;
 * - this device has verified online before, and within that many days;
 * - the session is missing because the network could not be reached: pass the
 *   `error` that came back from `getSession()`, or the browser reports itself
 *   offline.
 *
 * Anything else is null. In particular a device that was signed out, or whose
 * refresh token the server rejected, has had its grant cleared and gets null,
 * and so does a start that simply has no session while online.
 */
export declare function offlineGrantUserId(storage: StorageLike, accessStorageKey: string, offlineGraceDays: number, sessionError?: unknown): string | null;
export declare function AuthScreen({ appName, brandIcon, appId, storage, accessStorageKey, productId, supabase, isConfigured, fetchMachineId, onAuthenticated, desktopRequiresFeature, legacyStorageKey, allowOfflineMode, offlineGraceDays, termsVersion, onSignedOut }: AuthScreenProps): React.JSX.Element;
