import type { PluginListenerHandle } from '@capacitor/core';
/** One datagram as the native side received it, decoded as UTF-8. */
export interface UdpDatagramEvent {
    /** The listener it arrived on, as `listen()` answered. */
    id: number;
    /** The sender's address, as Android prints it (`192.168.4.1`, `fe80::1`). */
    address: string;
    /** The whole datagram. A gateway usually puts one or more NMEA lines in each. */
    data: string;
}
/** A listener that stopped by itself: the socket failed after it was bound. */
export interface UdpErrorEvent {
    id: number;
    message: string;
}
/**
 * The native plugin, registered as `SentinelUdp`. Android only: there is no iOS
 * or web implementation, and `isUdpAvailable()` says so rather than this
 * interface throwing.
 */
export interface SentinelUdpPlugin {
    /**
     * Bind `port` on every interface, with address reuse so a second app on the
     * same phone can listen beside this one, and start delivering datagrams.
     * Rejects when the port cannot be bound.
     */
    listen(options: {
        port: number;
    }): Promise<{
        id: number;
    }>;
    /** Close one listener. Closing one that is already gone is not an error. */
    close(options: {
        id: number;
    }): Promise<void>;
    addListener(eventName: 'datagram', listener: (event: UdpDatagramEvent) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'error', listener: (event: UdpErrorEvent) => void): Promise<PluginListenerHandle>;
}
