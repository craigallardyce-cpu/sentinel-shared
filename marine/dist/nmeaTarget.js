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
export const DEFAULT_NMEA_TARGET = { host: '10.10.10.1', port: '11102' };
function clean(value) {
    if (value === null || value === undefined)
        return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
/**
 * Split a pool key back into a host and port.
 *
 * Rightmost colon only, so an IPv6 literal survives the trip — `[fe80::1]:10110` keeps its
 * address rather than being cut at the first colon inside it.
 */
export function splitPoolKey(key) {
    const at = key.lastIndexOf(':');
    if (at <= 0 || at === key.length - 1)
        return null;
    return { host: key.slice(0, at), port: key.slice(at + 1) };
}
export function resolveNmeaTarget(input = {}) {
    const fallback = input.fallback ?? DEFAULT_NMEA_TARGET;
    const reqHost = clean(input.requested?.host);
    const reqPort = clean(input.requested?.port);
    if (reqHost && reqPort)
        return { host: reqHost, port: reqPort, source: 'requested' };
    const cfgHost = clean(input.config?.nmea_local_host);
    const cfgPort = clean(input.config?.nmea_local_port);
    if (cfgHost) {
        return { host: cfgHost, port: cfgPort ?? fallback.port, source: 'config' };
    }
    /*
      Only now the pool, and only because the configuration had nothing to say. This used to run
      first, which is what made a changed address impossible to apply without a restart.
    */
    for (const key of input.activeKeys ?? []) {
        const split = splitPoolKey(key);
        if (split)
            return { ...split, source: 'pool' };
    }
    return { host: fallback.host, port: fallback.port, source: 'fallback' };
}
/**
 * Pool keys that are no longer the configured target.
 *
 * Saving a new address has to do more than change what the next client is told: the sockets
 * already open to the old gateway keep delivering, so the chart goes on showing data from a
 * device the navigator has just stopped pointing at. These are the connections to close.
 */
export function stalePoolKeys(activeKeys, current) {
    const wanted = `${current.host}:${current.port}`;
    return [...activeKeys].filter((key) => key !== wanted);
}
