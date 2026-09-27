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
/** The gateway most boats ship with, and what both apps defaulted to independently. */
export const DEFAULT_NMEA_TARGET = {
    host: '10.10.10.1',
    port: '11102',
};
function clean(value) {
    if (value === null || value === undefined)
        return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
/** One value out of an untrusted one, or `'tcp'`. Anything unrecognised is not a transport. */
function protocolOf(value) {
    return clean(value) === 'udp' ? 'udp' : 'tcp';
}
/** The field, or nothing at all for TCP. See `NmeaTarget.protocol`. */
function protocolField(protocol) {
    return protocol === 'udp' ? { protocol } : {};
}
/**
 * The pool's key for a target, in one place because two files build it.
 *
 * TCP keeps the `host:port` it has always been, so every key already in a
 * running pool still parses and still matches. UDP is prefixed, because a UDP
 * listener on 11102 and a TCP connection to a gateway on 11102 are different
 * things and must never land on the same entry — and because a UDP listener
 * often has no host at all.
 */
export function nmeaPoolKey(target) {
    const port = String(target.port ?? '').trim();
    const host = clean(target.host);
    if (protocolOf(target.protocol) === 'udp')
        return host ? `udp:${host}:${port}` : `udp:${port}`;
    return `${host ?? ''}:${port}`;
}
/**
 * Split a pool key back into a host, a port and the transport that made it.
 *
 * Rightmost colon only, so an IPv6 literal survives the trip — `[fe80::1]:10110` keeps its
 * address rather than being cut at the first colon inside it.
 *
 * A `udp:` prefix is stripped first, and what remains may be a bare port: a UDP
 * listener bound for any source has no host, and comes back with `host: ''`.
 */
export function splitPoolKey(key) {
    if (key.startsWith('udp:')) {
        const rest = key.slice(4);
        const at = rest.lastIndexOf(':');
        if (at < 0) {
            // `udp:11102` — listening on a port for whatever any gateway broadcasts.
            return /^[0-9]+$/.test(rest) ? { host: '', port: rest, protocol: 'udp' } : null;
        }
        if (at === 0 || at === rest.length - 1)
            return null;
        return { host: rest.slice(0, at), port: rest.slice(at + 1), protocol: 'udp' };
    }
    // No `protocol` on a TCP key: the result is what it always was, for a caller
    // comparing the whole object. See `NmeaTarget.protocol`.
    const at = key.lastIndexOf(':');
    if (at <= 0 || at === key.length - 1)
        return null;
    return { host: key.slice(0, at), port: key.slice(at + 1) };
}
export function resolveNmeaTarget(input = {}) {
    const fallback = input.fallback ?? DEFAULT_NMEA_TARGET;
    /*
      The host requirement is relaxed for UDP alone: there is nothing to dial, so
      a port and the transport are a complete answer. For TCP the conditions below
      are exactly what they were — a request still needs both halves, and a
      configured host still outranks the pool.
    */
    const reqProtocol = protocolOf(input.requested?.protocol);
    const reqHost = clean(input.requested?.host);
    const reqPort = clean(input.requested?.port);
    if (reqPort && (reqHost || reqProtocol === 'udp')) {
        return { host: reqHost ?? '', port: reqPort, ...protocolField(reqProtocol), source: 'requested' };
    }
    const cfgProtocol = protocolOf(input.configured?.protocol);
    const cfgHost = clean(input.configured?.host);
    const cfgPort = clean(input.configured?.port);
    if (cfgHost || (cfgProtocol === 'udp' && cfgPort)) {
        return {
            host: cfgHost ?? '',
            port: cfgPort ?? fallback.port,
            ...protocolField(cfgProtocol),
            source: 'config',
        };
    }
    /*
      Only now the pool, and only because the configuration had nothing to say. This used to run
      first, which is what made a changed address impossible to apply without a restart.
    */
    for (const key of input.activeKeys ?? []) {
        const split = splitPoolKey(key);
        // A hostless UDP entry is a live feed but not an address, so it answers
        // only for its own transport and never stands in as somewhere to dial.
        if (split && (split.host || split.protocol === 'udp'))
            return { ...split, source: 'pool' };
    }
    return {
        host: fallback.host,
        port: fallback.port,
        ...protocolField(protocolOf(fallback.protocol)),
        source: 'fallback',
    };
}
/**
 * Pool keys that are no longer the configured target.
 *
 * Saving a new address has to do more than change what the next client is told: the sockets
 * already open to the old gateway keep delivering, so the chart goes on showing data from a
 * device the navigator has just stopped pointing at. These are the connections to close.
 */
export function stalePoolKeys(activeKeys, current) {
    const wanted = nmeaPoolKey(current);
    return [...activeKeys].filter((key) => key !== wanted);
}
