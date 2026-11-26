import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SentinelUdpPlugin } from './definitions.js';

/** The native plugin. Calling it anywhere but Android rejects; ask `isUdpAvailable()` first. */
export const SentinelUdp = registerPlugin<SentinelUdpPlugin>('SentinelUdp');

/**
 * Whether this device can listen for UDP itself.
 *
 * True only in a native build whose native side carries the plugin, which today
 * means Android. iOS has no implementation yet (receiving broadcast there needs
 * Apple's multicast networking entitlement), and a desktop or web build reaches
 * UDP through its backend instead, so both answer false.
 */
export function isUdpAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SentinelUdp');
}
