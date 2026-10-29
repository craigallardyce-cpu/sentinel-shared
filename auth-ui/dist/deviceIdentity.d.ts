import type { StorageLike } from './storage';
/**
 * Where a browser that is not the boat computer keeps the identifier it
 * registers under. A fixed key, so it can be found in an install's storage.
 */
export declare const BROWSER_DEVICE_ID_KEY = "sentinel_browser_device_id";
export interface DeviceIdentity {
    machineId: string;
    platformName: string;
}
export interface DeviceIdentityEnv {
    /** Capacitor.isNativePlatform() */
    isNative: boolean;
    /** Capacitor.getPlatform() */
    nativePlatform: string;
    /** Device.getId(), called only on native. */
    getNativeId: () => Promise<{
        identifier: string;
    }>;
    /** The app's own computer, read from the backend running beside it. */
    fetchMachineId: () => Promise<{
        machineId: string;
    }>;
    /** window.location.hostname; empty for a page with no host. */
    hostname: string;
    userAgent: string;
    storage: StorageLike;
    /** Defaults to crypto.randomUUID. */
    newId?: () => string;
}
/**
 * True when the page was loaded from this computer itself, which is where the
 * desktop apps load from (`http://localhost:<port>`).
 */
export declare function isLoopbackHost(hostname: string): boolean;
/**
 * The identifier this device registers under in `public.devices`, and the name
 * shown beside it on the account page.
 *
 * - Native: Device.getId(), which is ANDROID_ID on Android (see AuthScreen for
 *   why that is one value across the fleet's apps).
 * - The desktop app, and any browser on the boat computer itself: the
 *   computer's hardware id, read from the app's own backend.
 * - A browser anywhere else -- the cockpit tablet that loads the app FROM the
 *   boat computer over the LAN: an id of its own, minted once and kept in this
 *   browser's storage. Asking the backend here returned the boat computer's
 *   id, so every tablet paired to one boat counted as that one computer.
 *
 * A browser's id lasts as long as its site data. Clearing it, or opening a
 * fleet app on another port (another origin), registers a new device, which
 * the owner can revoke on the account page.
 */
export declare function resolveDeviceIdentity(env: DeviceIdentityEnv): Promise<DeviceIdentity>;
