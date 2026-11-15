import { describe, it, expect, vi } from 'vitest';
import {
  resolveDeviceIdentity,
  isLoopbackHost,
  BROWSER_DEVICE_ID_KEY,
  describeNativeDevice,
  describeBrowser,
  DEVICE_MODEL_MAX_LENGTH
} from '../src/deviceIdentity';
import type { DeviceIdentityEnv } from '../src/deviceIdentity';
import { memoryStorage } from './memoryStorage';

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/32';
const TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/130';

function env(overrides: Partial<DeviceIdentityEnv> = {}): DeviceIdentityEnv {
  return {
    isNative: false,
    nativePlatform: 'web',
    getNativeId: vi.fn(async () => ({ identifier: 'android-id' })),
    fetchMachineId: vi.fn(async () => ({ machineId: 'boat-pc-guid' })),
    hostname: 'localhost',
    userAgent: WINDOWS_UA,
    storage: memoryStorage(),
    ...overrides
  };
}

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', ''])('%s is this computer', (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each(['192.168.1.20', 'boat-pc.local', '10.0.0.5', 'marinersentinel.com'])('%s is another computer', (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('resolveDeviceIdentity', () => {
  it('uses the native id on a phone and never asks a backend', async () => {
    const e = env({ isNative: true, nativePlatform: 'android', hostname: 'localhost' });
    expect(await resolveDeviceIdentity(e)).toEqual({ machineId: 'android-id', platformName: 'Android Phone/Tablet', deviceModel: null });
    expect(e.fetchMachineId).not.toHaveBeenCalled();
  });

  it('reads the hardware id from its own backend on the desktop app', async () => {
    const e = env();
    expect(await resolveDeviceIdentity(e)).toEqual({ machineId: 'boat-pc-guid', platformName: 'Windows Desktop', deviceModel: null });
    expect(e.storage.getItem(BROWSER_DEVICE_ID_KEY)).toBeNull();
  });

  it('gives a browser on the LAN an id of its own, not the boat computer\'s', async () => {
    const e = env({ hostname: '192.168.1.20', userAgent: TABLET_UA, newId: () => 'abc' });
    const identity = await resolveDeviceIdentity(e);
    expect(identity).toEqual({ machineId: 'browser-abc', platformName: 'Web Browser', deviceModel: 'Chrome on Android' });
    expect(e.fetchMachineId).not.toHaveBeenCalled();
  });

  it('keeps the same browser id on the next sign-in', async () => {
    const storage = memoryStorage();
    let n = 0;
    const newId = () => `id${++n}`;
    const first = await resolveDeviceIdentity(env({ hostname: 'boat-pc.local', storage, newId }));
    const second = await resolveDeviceIdentity(env({ hostname: 'boat-pc.local', storage, newId }));
    expect(first.machineId).toBe('browser-id1');
    expect(second.machineId).toBe('browser-id1');
  });

  it('gives two tablets on one boat two different ids', async () => {
    const a = await resolveDeviceIdentity(env({ hostname: '192.168.1.20', storage: memoryStorage() }));
    const b = await resolveDeviceIdentity(env({ hostname: '192.168.1.20', storage: memoryStorage() }));
    expect(a.machineId).not.toBe(b.machineId);
    expect(a.machineId).toMatch(/^browser-[0-9a-f-]{32,36}$/);
  });

  it('shares one id between fleet apps opened from one boat computer, through the host cookie', async () => {
    // Two apps on two ports: separate localStorage, one cookie jar for the host.
    let jar = '';
    const cookies = {
      read: () => jar,
      write: (c: string) => {
        const [pair] = c.split(';');
        const name = pair.split('=')[0];
        const rest = jar.split('; ').filter((p) => p && !p.startsWith(`${name}=`));
        jar = [...rest, pair].join('; ');
      }
    };
    const harbor = await resolveDeviceIdentity(env({ hostname: '192.168.1.20', storage: memoryStorage(), cookies }));
    const ocean = await resolveDeviceIdentity(env({ hostname: '192.168.1.20', storage: memoryStorage(), cookies }));
    expect(ocean.machineId).toBe(harbor.machineId);
  });

  it('carries on when cookies are refused', async () => {
    const storage = memoryStorage();
    const cookies = {
      read: () => { throw new Error('blocked'); },
      write: () => { throw new Error('blocked'); }
    };
    const first = await resolveDeviceIdentity(env({ hostname: 'boat-pc.local', storage, cookies, newId: () => 'x' }));
    const again = await resolveDeviceIdentity(env({ hostname: 'boat-pc.local', storage, cookies, newId: () => 'y' }));
    expect(first.machineId).toBe('browser-x');
    expect(again.machineId).toBe('browser-x');
  });
});

describe('the label the account page shows', () => {
  const S23 = { manufacturer: 'samsung', model: 'SM-S711U', operatingSystem: 'android', osVersion: '16' };

  it('names a phone by make, model and OS', async () => {
    const e = env({ isNative: true, nativePlatform: 'android', getNativeInfo: vi.fn(async () => S23) });
    expect((await resolveDeviceIdentity(e)).deviceModel).toBe('Samsung SM-S711U · Android 16');
  });

  it('still registers when the model cannot be read', async () => {
    const e = env({
      isNative: true,
      nativePlatform: 'android',
      getNativeInfo: vi.fn(async () => { throw new Error('no plugin'); })
    });
    expect(await resolveDeviceIdentity(e)).toEqual({
      machineId: 'android-id',
      platformName: 'Android Phone/Tablet',
      deviceModel: null
    });
  });

  it('never reads device info on the desktop app', async () => {
    const getNativeInfo = vi.fn(async () => S23);
    expect((await resolveDeviceIdentity(env({ getNativeInfo }))).deviceModel).toBeNull();
    expect(getNativeInfo).not.toHaveBeenCalled();
  });

  it('does not repeat a maker the model already names', () => {
    expect(describeNativeDevice({ manufacturer: 'OnePlus', model: 'OnePlus 12', operatingSystem: 'android', osVersion: '15' }))
      .toBe('OnePlus 12 · Android 15');
    expect(describeNativeDevice({ manufacturer: 'Google', model: 'Pixel 8', operatingSystem: 'android', osVersion: '16' }))
      .toBe('Google Pixel 8 · Android 16');
    expect(describeNativeDevice({ manufacturer: 'Apple', model: 'iPad13,1', operatingSystem: 'ios', osVersion: '18.1' }))
      .toBe('Apple iPad13,1 · iOS 18.1');
  });

  it('gives no label from empty info, and clips a long one', () => {
    expect(describeNativeDevice({})).toBeNull();
    expect(describeNativeDevice(null)).toBeNull();
    const long = describeNativeDevice({ manufacturer: 'x', model: 'y'.repeat(500) });
    expect(long!.length).toBe(DEVICE_MODEL_MAX_LENGTH);
  });

  it.each([
    ['Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1', 'Safari on iPad'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130', 'Edge on Windows'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/150 Safari/537.36', 'Chrome on ChromeOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Mac'],
    ['', null]
  ])('names a browser from its user agent: %s', (ua, label) => {
    expect(describeBrowser(ua)).toBe(label);
  });
});
