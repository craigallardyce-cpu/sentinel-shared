import { describe, it, expect, vi } from 'vitest';
import { resolveDeviceIdentity, isLoopbackHost, BROWSER_DEVICE_ID_KEY } from '../src/deviceIdentity';
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
    expect(await resolveDeviceIdentity(e)).toEqual({ machineId: 'android-id', platformName: 'Android Phone/Tablet' });
    expect(e.fetchMachineId).not.toHaveBeenCalled();
  });

  it('reads the hardware id from its own backend on the desktop app', async () => {
    const e = env();
    expect(await resolveDeviceIdentity(e)).toEqual({ machineId: 'boat-pc-guid', platformName: 'Windows Desktop' });
    expect(e.storage.getItem(BROWSER_DEVICE_ID_KEY)).toBeNull();
  });

  it('gives a browser on the LAN an id of its own, not the boat computer\'s', async () => {
    const e = env({ hostname: '192.168.1.20', userAgent: TABLET_UA, newId: () => 'abc' });
    const identity = await resolveDeviceIdentity(e);
    expect(identity).toEqual({ machineId: 'browser-abc', platformName: 'Web Browser' });
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
