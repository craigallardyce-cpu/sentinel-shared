/**
 * Which NMEA gateway to connect to, decided in one place for the whole fleet.
 *
 * The rule is small and the apps had it written out twice, identically wrong in the same way:
 * an existing pooled connection was consulted BEFORE the stored configuration. That ordering is
 * the reason changing the NMEA address appeared to do nothing. The save landed, the next client
 * looked for somewhere to attach, found the socket already open to the old gateway, and joined
 * it. Nothing was stale except the precedence, and nothing short of restarting the process
 * cleared it.
 *
 * Configuration outranks an open socket, because configuration is what the navigator just
 * changed and the socket is merely what happened to be true beforehand. The pool is still
 * consulted — sharing one TCP connection between clients is the point of having a pool — but
 * only for an address the configuration agrees with, and only when nothing more specific was
 * asked for.
 */
export interface NmeaTargetConfig {
    nmea_local_host?: string | null;
    nmea_local_port?: number | string | null;
}
export interface ResolveNmeaTargetInput {
    /** An explicit request, e.g. from a query string. Beats everything. */
    requested?: {
        host?: string | null;
        port?: string | number | null;
    };
    /** The stored configuration row, if one could be read. */
    config?: NmeaTargetConfig | null;
    /** Keys currently in the connection pool, as `host:port`. */
    activeKeys?: Iterable<string>;
    /** Last-resort gateway, used when nothing else answers. */
    fallback?: {
        host: string;
        port: string;
    };
}
export interface NmeaTarget {
    host: string;
    port: string;
    /** Where the answer came from, so callers can log it without guessing. */
    source: 'requested' | 'config' | 'pool' | 'fallback';
}
/** The gateway most boats ship with, and what both apps defaulted to independently. */
export declare const DEFAULT_NMEA_TARGET: {
    host: string;
    port: string;
};
/**
 * Split a pool key back into a host and port.
 *
 * Rightmost colon only, so an IPv6 literal survives the trip — `[fe80::1]:10110` keeps its
 * address rather than being cut at the first colon inside it.
 */
export declare function splitPoolKey(key: string): {
    host: string;
    port: string;
} | null;
export declare function resolveNmeaTarget(input?: ResolveNmeaTargetInput): NmeaTarget;
/**
 * Pool keys that are no longer the configured target.
 *
 * Saving a new address has to do more than change what the next client is told: the sockets
 * already open to the old gateway keep delivering, so the chart goes on showing data from a
 * device the navigator has just stopped pointing at. These are the connections to close.
 */
export declare function stalePoolKeys(activeKeys: Iterable<string>, current: {
    host: string;
    port: string;
}): string[];
