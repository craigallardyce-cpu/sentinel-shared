import type { StorageLike } from './storage';
/**
 * Where a browser that is not the boat computer keeps the identifier it
 * registers under. A fixed key, so it can be found in an install's storage.
 */
export declare const BROWSER_DEVICE_ID_KEY = "sentinel_browser_device_id";
export interface DeviceIdentity {
    machineId: string;
    platformName: string;
    /**
     * What the account page shows to tell this device from the owner's others:
     * the make and model and its OS on a phone or tablet ("Samsung SM-S711U ·
     * Android 16"), the browser and its OS on a browser elsewhere on the LAN
     * ("Chrome on Android"). Null on the desktop app, where the platform name
     * is all there is, and whenever it could not be read. Never the name the
     * owner gave the device, which can carry a person's name.
     */
    deviceModel: string | null;
}
/** The fields of @capacitor/device's DeviceInfo this reads. */
export interface NativeDeviceInfo {
    manufacturer?: string;
    model?: string;
    operatingSystem?: string;
    osVersion?: string;
}
/** Longest label written to `devices.device_model`; website migration 084 checks the same. */
export declare const DEVICE_MODEL_MAX_LENGTH = 120;
export interface DeviceIdentityEnv {
    /** Capacitor.isNativePlatform() */
    isNative: boolean;
    /** Capacitor.getPlatform() */
    nativePlatform: string;
    /** Device.getId(), called only on native. */
    getNativeId: () => Promise<{
        identifier: string;
    }>;
    /** Device.getInfo(), called only on native. A failure leaves the label out. */
    getNativeInfo?: () => Promise<NativeDeviceInfo>;
    /** The app's own computer, read from the backend running beside it. */
    fetchMachineId: () => Promise<{
        machineId: string;
    }>;
    /** window.location.hostname; empty for a page with no host. */
    hostname: string;
    userAgent: string;
    storage: StorageLike;
    /**
     * The page's cookies (`document.cookie`), when there is a document. A cookie
     * is scoped to the host and not the port, so every fleet app a browser opens
     * from one boat computer reads the same one; localStorage is per port.
     */
    cookies?: {
        read(): string;
        write(cookie: string): void;
    };
    /** Defaults to crypto.randomUUID. */
    newId?: () => string;
}
/**
 * True when the page was loaded from this computer itself, which is where the
 * desktop apps load from (`http://localhost:<port>`).
 */
export declare function isLoopbackHost(hostname: string): boolean;
/**
 * "Samsung SM-S711U · Android 16". The manufacturer is dropped when the model
 * already starts with it ("Google" + "Pixel 8" keeps both; "OnePlus" +
 * "OnePlus 12" does not repeat itself).
 */
export declare function describeNativeDevice(info: NativeDeviceInfo | null | undefined): string | null;
/** "Chrome on Android", from a browser's user agent. Null when neither part is recognised. */
export declare function describeBrowser(userAgent: string): string | null;
/**
 * The identifier this device registers under in `public.devices`, and the name
 * shown beside it on the account page.
 *
 * - Native: Device.getId(), which is ANDROID_ID on Android (see AuthScreen for
 *   why that is one value across the fleet's apps).
 * - The desktop app, and any browser on the boat computer itself: the
 *   computer's hardware id, read from the app's own backend.
 * - A browser anywhere else -- the cockpit tablet that loads the app FROM the
 *   boat computer over the LAN: an id of its own, minted once and kept in a
 *   cookie for that host, so HarborSentinel and OceanSentinel opened from one
 *   boat computer share it although they run on different ports, and in this
 *   app's storage as well. Asking the backend here returned the boat
 *   computer's id, so every tablet paired to one boat counted as that one
 *   computer.
 *
 * A browser's id lasts as long as its site data. Clearing it registers a new
 * device, which the owner can revoke on the account page.
 */
export declare function resolveDeviceIdentity(env: DeviceIdentityEnv): Promise<DeviceIdentity>;
