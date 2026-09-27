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
/**
 * How the fleet reaches an NMEA gateway.
 *
 * `tcp` dials the gateway and holds one connection, which is the only transport
 * the fleet had and stays the default everywhere. `udp` binds the port and
 * listens for what the gateway broadcasts, which has no client slot to contend
 * for -- any number of devices can receive the same feed.
 *
 * Under `udp` a host is a FILTER on the source address rather than somewhere to
 * dial, so it is optional: absent means accept from any source.
 */
export type NmeaProtocol = 'tcp' | 'udp';
export interface ResolveNmeaTargetInput {
    /** An explicit request, e.g. from a query string. Beats everything. */
    requested?: {
        host?: string | null;
        port?: string | number | null;
        protocol?: string | null;
    };
    /**
     * The configured gateway, already resolved.
     *
     * This took HarborSentinel's `system_config` row -- `nmea_local_host` and
     * `nmea_local_port` -- which meant a function about precedence knew the column
     * names of one app's database. It now takes an address, resolved by
     * `@sentinel/settings` through account -> vessel -> host -> device, so a phone
     * reaching the gateway through a PC and the PC reaching it directly are both
     * just an address by the time they arrive here.
     */
    configured?: {
        host?: string | null;
        port?: string | number | null;
        protocol?: string | null;
    } | null;
    /** Keys currently in the connection pool, as `nmeaPoolKey` builds them. */
    activeKeys?: Iterable<string>;
    /** Last-resort gateway, used when nothing else answers. */
    fallback?: {
        host: string;
        port: string;
        protocol?: NmeaProtocol;
    };
}
export interface NmeaTarget {
    /** Empty only for a `udp` target that accepts datagrams from any source. */
    host: string;
    port: string;
    /**
     * **Absent means `tcp`.** Read it as `target.protocol ?? 'tcp'`.
     *
     * Optional, and left off entirely rather than set to `'tcp'`, so that a TCP
     * target resolves to exactly the object it resolved to before UDP existed --
     * including for a caller comparing the whole thing. Everything already
     * holding an `NmeaTarget`, or building one, keeps working untouched, which is
     * the whole bar for adding a transport to a path the anchor watch runs on.
     */
    protocol?: NmeaProtocol;
    /** Where the answer came from, so callers can log it without guessing. */
    source: 'requested' | 'config' | 'pool' | 'fallback';
}
/** The gateway most boats ship with, and what both apps defaulted to independently. */
export declare const DEFAULT_NMEA_TARGET: {
    host: string;
    port: string;
    protocol?: NmeaProtocol;
};
/**
 * The pool's key for a target, in one place because two files build it.
 *
 * TCP keeps the `host:port` it has always been, so every key already in a
 * running pool still parses and still matches. UDP is prefixed, because a UDP
 * listener on 11102 and a TCP connection to a gateway on 11102 are different
 * things and must never land on the same entry — and because a UDP listener
 * often has no host at all.
 */
export declare function nmeaPoolKey(target: {
    host?: string | null;
    port: string | number;
    protocol?: NmeaProtocol | null;
}): string;
/**
 * Split a pool key back into a host, a port and the transport that made it.
 *
 * Rightmost colon only, so an IPv6 literal survives the trip — `[fe80::1]:10110` keeps its
 * address rather than being cut at the first colon inside it.
 *
 * A `udp:` prefix is stripped first, and what remains may be a bare port: a UDP
 * listener bound for any source has no host, and comes back with `host: ''`.
 */
export declare function splitPoolKey(key: string): {
    host: string;
    port: string;
    protocol?: NmeaProtocol;
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
    protocol?: NmeaProtocol;
}): string[];
