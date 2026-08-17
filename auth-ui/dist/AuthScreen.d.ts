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
    fetchMachineId: () => Promise<{
        machineId: string;
    }>;
    onAuthenticated: () => void;
    /** If set, any value under this old localStorage key is migrated to accessStorageKey on mount. */
    legacyStorageKey?: string;
    /** If true, shows "Run Offline (Local-Only Mode)" buttons that bypass auth entirely by calling onAuthenticated. */
    allowOfflineMode?: boolean;
}
export declare function AuthScreen({ appName, appId, accessStorageKey, productId, supabase, isConfigured, fetchMachineId, onAuthenticated, legacyStorageKey, allowOfflineMode }: AuthScreenProps): React.JSX.Element;
