import type { SentinelUdpPlugin } from './definitions.js';
export declare const UDP_DATA_TIMEOUT_MS = 15000;
export interface CapacitorUdpClientOptions {
    /** The native plugin; the tests pass a fake. */
    plugin?: SentinelUdpPlugin;
    /** Silence that ends the listener. */
    dataTimeoutMs?: number;
}
/** Whether a datagram from `address` passes the gateway address filter. */
export declare function sourceMatches(filterHost: string | null | undefined, address: string | null | undefined): boolean;
/** The NMEA lines in one datagram. */
export declare function splitDatagram(text: string): string[];
export declare class CapacitorUdpClient {
    private readonly plugin;
    private readonly dataTimeoutMs;
    private session;
    constructor({ plugin, dataTimeoutMs }?: CapacitorUdpClientOptions);
    /** Whether a listener is open, or being opened. */
    get isActive(): boolean;
    connect(host: string | null | undefined, port: string | number, onData: (sentence: string) => void, onError?: (err: unknown) => void, _onClose?: () => void): Promise<void>;
    disconnect(): Promise<void>;
    /** UDP input is receive-only here, as it is on the desktop. */
    send(_data: string): Promise<void>;
    /** End a session that stopped by itself, without waiting on the native close. */
    private retire;
    private release;
}
export interface ListenForSentencesOptions {
    host?: string | null;
    port: string | number;
    /** How long to listen. */
    durationMs?: number;
    plugin?: SentinelUdpPlugin;
}
/**
 * Listen for a while and count the NMEA sentences heard: the Settings dialogs'
 * "Test" under UDP, which has nothing to connect to and so can only report what
 * arrived. Rejects when the port cannot be bound.
 */
export declare function listenForSentences({ host, port, durationMs, plugin }: ListenForSentencesOptions): Promise<number>;
