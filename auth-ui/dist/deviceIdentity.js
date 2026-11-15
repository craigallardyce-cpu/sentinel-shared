/**
 * Where a browser that is not the boat computer keeps the identifier it
 * registers under. A fixed key, so it can be found in an install's storage.
 */
export const BROWSER_DEVICE_ID_KEY = 'sentinel_browser_device_id';
/** Longest label written to `devices.device_model`; website migration 084 checks the same. */
export const DEVICE_MODEL_MAX_LENGTH = 120;
/**
 * True when the page was loaded from this computer itself, which is where the
 * desktop apps load from (`http://localhost:<port>`).
 */
export function isLoopbackHost(hostname) {
    const host = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    return host === '' || host === 'localhost' || host === '::1' || /^127\./.test(host);
}
function desktopOs(userAgent) {
    if (userAgent.includes('Windows'))
        return 'Windows';
    if (userAgent.includes('Mac'))
        return 'Mac';
    return 'Linux';
}
function clip(label) {
    const text = label.replace(/\s+/g, ' ').trim();
    if (!text)
        return null;
    return text.length > DEVICE_MODEL_MAX_LENGTH ? text.slice(0, DEVICE_MODEL_MAX_LENGTH) : text;
}
const OS_NAMES = { android: 'Android', ios: 'iOS' };
/**
 * "Samsung SM-S711U · Android 16". The manufacturer is dropped when the model
 * already starts with it ("Google" + "Pixel 8" keeps both; "OnePlus" +
 * "OnePlus 12" does not repeat itself).
 */
export function describeNativeDevice(info) {
    if (!info)
        return null;
    const maker = (info.manufacturer || '').trim();
    const model = (info.model || '').trim();
    const makerName = maker ? maker.charAt(0).toUpperCase() + maker.slice(1) : '';
    const hardware = makerName && model.toLowerCase().startsWith(maker.toLowerCase())
        ? model
        : [makerName, model].filter(Boolean).join(' ');
    const osName = OS_NAMES[(info.operatingSystem || '').toLowerCase()] ?? '';
    const os = [osName, (info.osVersion || '').trim()].filter(Boolean).join(' ');
    return clip([hardware, os].filter(Boolean).join(' · '));
}
/** "Chrome on Android", from a browser's user agent. Null when neither part is recognised. */
export function describeBrowser(userAgent) {
    const ua = userAgent || '';
    const browser = /Edg\//.test(ua)
        ? 'Edge'
        : /Firefox\/|FxiOS\//.test(ua)
            ? 'Firefox'
            : /Chrome\/|CriOS\//.test(ua)
                ? 'Chrome'
                : /Safari\//.test(ua)
                    ? 'Safari'
                    : '';
    const os = /Android/.test(ua)
        ? 'Android'
        : /iPad/.test(ua)
            ? 'iPad'
            : /iPhone|iPod/.test(ua)
                ? 'iPhone'
                : /CrOS/.test(ua)
                    ? 'ChromeOS'
                    : /Windows/.test(ua)
                        ? 'Windows'
                        : /Mac OS X|Macintosh/.test(ua)
                            ? 'Mac'
                            : /Linux/.test(ua)
                                ? 'Linux'
                                : '';
    if (!browser && !os)
        return null;
    return clip(browser && os ? `${browser} on ${os}` : browser || os);
}
function randomId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function')
        return c.randomUUID();
    // crypto.randomUUID needs a secure context, and a tablet loading the boat
    // computer over plain http on the LAN is not one. getRandomValues does not.
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
        c.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
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
export async function resolveDeviceIdentity(env) {
    if (env.isNative) {
        const info = await env.getNativeId();
        const platformName = env.nativePlatform === 'ios' ? 'iOS Phone/Tablet' : 'Android Phone/Tablet';
        let deviceModel = null;
        try {
            deviceModel = describeNativeDevice(env.getNativeInfo ? await env.getNativeInfo() : null);
        }
        catch {
            // A label is a convenience. Registering the device must not depend on it.
            deviceModel = null;
        }
        return { machineId: info.identifier, platformName, deviceModel };
    }
    if (isLoopbackHost(env.hostname)) {
        const { machineId } = await env.fetchMachineId();
        return { machineId, platformName: `${desktopOs(env.userAgent)} Desktop`, deviceModel: null };
    }
    let machineId = readCookie(env.cookies) ?? env.storage.getItem(BROWSER_DEVICE_ID_KEY);
    if (!machineId)
        machineId = `browser-${(env.newId ?? randomId)()}`;
    env.storage.setItem(BROWSER_DEVICE_ID_KEY, machineId);
    writeCookie(env.cookies, machineId);
    return { machineId, platformName: 'Web Browser', deviceModel: describeBrowser(env.userAgent) };
}
const COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)${BROWSER_DEVICE_ID_KEY}=([^;]+)`);
function readCookie(cookies) {
    try {
        const match = cookies?.read().match(COOKIE_PATTERN);
        return match ? decodeURIComponent(match[1]) : null;
    }
    catch {
        return null;
    }
}
function writeCookie(cookies, id) {
    try {
        // Ten years; refreshed at every sign-in.
        cookies?.write(`${BROWSER_DEVICE_ID_KEY}=${encodeURIComponent(id)}; path=/; max-age=315360000; SameSite=Lax`);
    }
    catch {
        /* Cookies disabled: localStorage above still holds it for this app. */
    }
}
