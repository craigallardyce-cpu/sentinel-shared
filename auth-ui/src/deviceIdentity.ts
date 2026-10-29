import type { StorageLike } from './storage';

/**
 * Where a browser that is not the boat computer keeps the identifier it
 * registers under. A fixed key, so it can be found in an install's storage.
 */
export const BROWSER_DEVICE_ID_KEY = 'sentinel_browser_device_id';

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
  getNativeId: () => Promise<{ identifier: string }>;
  /** The app's own computer, read from the backend running beside it. */
  fetchMachineId: () => Promise<{ machineId: string }>;
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
export function isLoopbackHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === '' || host === 'localhost' || host === '::1' || /^127\./.test(host);
}

function desktopOs(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'Windows';
  if (userAgent.includes('Mac')) return 'Mac';
  return 'Linux';
}

function randomId(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // crypto.randomUUID needs a secure context, and a tablet loading the boat
  // computer over plain http on the LAN is not one. getRandomValues does not.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
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
 *   boat computer over the LAN: an id of its own, minted once and kept in this
 *   browser's storage. Asking the backend here returned the boat computer's
 *   id, so every tablet paired to one boat counted as that one computer.
 *
 * A browser's id lasts as long as its site data. Clearing it, or opening a
 * fleet app on another port (another origin), registers a new device, which
 * the owner can revoke on the account page.
 */
export async function resolveDeviceIdentity(env: DeviceIdentityEnv): Promise<DeviceIdentity> {
  if (env.isNative) {
    const info = await env.getNativeId();
    const platformName = env.nativePlatform === 'ios' ? 'iOS Phone/Tablet' : 'Android Phone/Tablet';
    return { machineId: info.identifier, platformName };
  }

  if (isLoopbackHost(env.hostname)) {
    const { machineId } = await env.fetchMachineId();
    return { machineId, platformName: `${desktopOs(env.userAgent)} Desktop` };
  }

  let machineId = env.storage.getItem(BROWSER_DEVICE_ID_KEY);
  if (!machineId) {
    machineId = `browser-${(env.newId ?? randomId)()}`;
    env.storage.setItem(BROWSER_DEVICE_ID_KEY, machineId);
  }
  return { machineId, platformName: 'Web Browser' };
}
