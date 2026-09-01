/**
 * One TCP connection to an NMEA gateway, shared by every client that wants it.
 *
 * HarborSentinel and OceanSentinel each carried their own copy of this. They
 * descend from the same OpenCPN behaviour and stayed closer than anyone expected:
 * every function one had, the other had under the same name, both keyed an open
 * socket by `host:port`, both fanned sentences out to SSE and WebSocket clients,
 * both ran an eight-second watchdog and reconnected on a fixed five-second delay,
 * and both cited OpenCPN's `N_DOG_TIMEOUT` in their comments. Not two solutions
 * to one problem — one solution typed twice.
 *
 * **This is the anchor watch's data path.** Every position fix a drag alarm
 * evaluates arrives through here. A regression does not look like a broken page;
 * it looks like a watch that stops noticing the boat has moved, overnight, on a
 * mooring. Nothing else in either app carries that consequence.
 *
 * Four things genuinely differed between the two copies, and each is an option
 * rather than a branch:
 *
 *   1. Timings.      Harbor read them from a constants module, Ocean declared
 *                    them at the top of the file. The numbers already agreed, so
 *                    leaving them hardcoded here would have this package quietly
 *                    owning a tuning decision each app thinks it owns.
 *   2. Sentences.    Harbor keeps a live snapshot of position, wind and depth for
 *                    the anchor watch to read; Ocean parses downstream. → `onSentence`
 *   3. Close policy. Harbor declines to close while an anchor watch is running, so
 *                    a closed browser tab cannot end a boat's drag alarm. That is a
 *                    product rule, not a pooling rule, and must not live in here.
 *                    → `shouldKeepAlive`
 *   4. State.        Harbor tracks `isSocketConnected` per entry and reports it;
 *                    Ocean has no equivalent. Carrying it costs Ocean a boolean it
 *                    can ignore and is far cheaper than two entry shapes.
 *
 * Two more things this file deliberately does not know:
 *
 * **How to open a socket.** `createConnection` is injected. This package compiles
 * with `lib: ES2020` and no Node types, so that a piece of marine logic cannot
 * reach for a host API by accident — and it means the tests drive a stub rather
 * than a real TCP server.
 *
 * **What a client is.** Harbor types its clients as an Express `Response` and a
 * `ws` `WebSocket`. Typed structurally — anything with `write` and `end`,
 * anything with `send` — two peer dependencies stay out of a package three apps
 * install.
 *
 * **Address resolution stays out.** Ocean takes a host and port from its client
 * on every request; Harbor resolves them server-side. That is a real
 * architectural difference rather than drift, so the pool is handed a target and
 * never decides one. See `resolveNmeaTarget`.
 */
/**
 * This package carries no Node or DOM types, so timers are taken from the host
 * explicitly rather than by widening the lib — the same approach as `backoff.ts`.
 */
const host = globalThis;
const SILENT = { info: () => { }, warn: () => { }, error: () => { } };
/**
 * A factory, not module-level state.
 *
 * Harbor's copy held the pool, the timers and the "current" host and port in
 * module scope, which means two hosts in one process share one pool and quietly
 * fight over it. Nothing needs that, and a test certainly does not.
 */
export function createNmeaPool(options) {
    const { createConnection, watchdogSeconds = 8, reconnectDelayMs = 5000, onSentence, shouldKeepAlive, normalizeHost = (value) => value, log = SILENT, } = options;
    const entries = new Map();
    const timers = new Map();
    function getTimers(key) {
        let found = timers.get(key);
        if (!found) {
            found = { watchdogInterval: null, watchdogCounter: 0, reconnectTimer: null };
            timers.set(key, found);
        }
        return found;
    }
    function keepAlive(key) {
        if (!shouldKeepAlive)
            return false;
        try {
            return shouldKeepAlive(key);
        }
        catch (error) {
            /*
              The host's answer is unavailable, and the safe direction is unambiguous:
              assume a watch may be running rather than close the feed it depends on.
            */
            log.error(`[NMEA Pool] shouldKeepAlive failed for ${key}: ${error?.message ?? error}`);
            return true;
        }
    }
    function broadcast(key, chunk) {
        const conn = entries.get(key);
        if (!conn)
            return;
        conn.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const lines = conn.buffer.split(/\r?\n/);
        conn.buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || (!trimmed.startsWith('$') && !trimmed.startsWith('!')))
                continue;
            for (const client of conn.clients) {
                try {
                    client.write(`data: ${trimmed}\n\n`);
                }
                catch {
                    /* Client already gone; the close handler will remove it. */
                }
            }
            for (const wsClient of conn.wsClients) {
                if (wsClient.readyState !== 1)
                    continue;
                try {
                    wsClient.send(JSON.stringify({ type: 'nmea', sentence: trimmed }));
                }
                catch {
                    /* As above. */
                }
            }
            if (onSentence) {
                try {
                    onSentence(trimmed);
                }
                catch (error) {
                    /*
                      A consumer that throws must not take the stream down with it. This is
                      HarborSentinel's live snapshot for the anchor watch: one bad sentence
                      should cost that sentence, not the feed.
                    */
                    log.error(`[NMEA Pool] onSentence threw: ${error?.message ?? error}`);
                }
            }
        }
    }
    function notify(key, sse, ws) {
        const conn = entries.get(key);
        if (!conn)
            return;
        for (const client of conn.clients) {
            try {
                client.write(sse);
            }
            catch {
                /* Client already gone. */
            }
        }
        for (const wsClient of conn.wsClients) {
            if (wsClient.readyState !== 1)
                continue;
            try {
                wsClient.send(JSON.stringify(ws));
            }
            catch {
                /* As above. */
            }
        }
    }
    function stopWatchdog(key) {
        const t = getTimers(key);
        if (t.watchdogInterval) {
            host.clearInterval(t.watchdogInterval);
            t.watchdogInterval = null;
        }
        t.watchdogCounter = 0;
    }
    /**
     * OpenCPN's watchdog: count down every second, data resets it, zero means the
     * connection is stale even though the socket still looks open. That last part
     * is the whole point — a half-open TCP connection reports nothing wrong.
     */
    function startWatchdog(key) {
        stopWatchdog(key);
        const t = getTimers(key);
        t.watchdogCounter = watchdogSeconds;
        t.watchdogInterval = host.setInterval(() => {
            t.watchdogCounter -= 1;
            if (t.watchdogCounter > 0)
                return;
            log.warn(`[NMEA Watchdog] No data for ${watchdogSeconds}s on ${key}. Reconnecting.`);
            stopWatchdog(key);
            // Destroy the socket but keep the entry, so attached clients survive.
            const conn = entries.get(key);
            if (conn) {
                try {
                    conn.socket.destroy();
                }
                catch {
                    /* Already gone. */
                }
            }
            scheduleReconnect(key);
        }, 1000);
    }
    function feedWatchdog(key) {
        getTimers(key).watchdogCounter = watchdogSeconds;
    }
    function clearReconnectTimer(key) {
        const t = getTimers(key);
        if (t.reconnectTimer) {
            host.clearTimeout(t.reconnectTimer);
            t.reconnectTimer = null;
        }
    }
    function scheduleReconnect(key) {
        clearReconnectTimer(key);
        const at = key.lastIndexOf(':');
        const targetHost = at > 0 ? key.slice(0, at) : '';
        const targetPort = Number(key.slice(at + 1));
        if (!targetHost || !targetPort)
            return;
        log.info(`[NMEA Pool] Reconnecting to ${key} in ${reconnectDelayMs}ms.`);
        notify(key, `event: reconnecting\ndata: Reconnecting in ${reconnectDelayMs / 1000}s...\n\n`, {
            type: 'status',
            status: 'reconnecting',
            message: `Reconnecting in ${reconnectDelayMs / 1000}s...`,
        });
        const t = getTimers(key);
        t.reconnectTimer = host.setTimeout(() => {
            t.reconnectTimer = null;
            attemptReconnect(key, targetHost, targetPort);
        }, reconnectDelayMs);
    }
    function attemptReconnect(key, targetHost, targetPort) {
        log.info(`[NMEA Pool] Attempting reconnection to ${key}.`);
        try {
            const socket = createConnection({ host: targetHost, port: targetPort }, () => {
                log.info(`[NMEA Pool] Reconnected to ${key}.`);
                const conn = entries.get(key);
                if (conn) {
                    conn.isSocketConnected = true;
                    conn.lastLoggedErrorMsg = '';
                }
                configureSocket(socket);
                startWatchdog(key);
                notify(key, 'event: reconnected\ndata: Connection restored\n\n', {
                    type: 'status',
                    status: 'connected',
                    message: 'Connection restored',
                });
            });
            const existing = entries.get(key);
            if (existing) {
                existing.socket = socket;
                existing.buffer = '';
            }
            else {
                entries.set(key, newEntry(socket));
            }
            attachHandlers(socket, key);
        }
        catch (error) {
            const message = error?.message ?? String(error);
            log.error(`[NMEA Pool] Reconnection to ${key} failed: ${message}`);
            const conn = entries.get(key);
            if (conn) {
                conn.isSocketConnected = false;
                conn.lastLoggedErrorMsg = message;
            }
            // Never give up: a gateway that is off is still a gateway that comes back.
            scheduleReconnect(key);
        }
    }
    /** TCP_NODELAY as OpenCPN sets it, plus keepalive so a half-open socket is noticed. */
    function configureSocket(socket) {
        try {
            socket.setNoDelay?.(true);
            socket.setKeepAlive?.(true, 10000);
        }
        catch {
            /* A socket-like without these is fine; they are optimisations, not correctness. */
        }
    }
    function newEntry(socket) {
        return {
            socket,
            clients: new Set(),
            wsClients: new Set(),
            buffer: '',
            isSocketConnected: false,
            lastLoggedErrorMsg: '',
            lastErrorLoggedTime: 0,
        };
    }
    function attachHandlers(socket, key) {
        socket.on('data', (chunk) => {
            feedWatchdog(key);
            broadcast(key, chunk);
        });
        socket.on('error', (error) => {
            const message = error?.message ?? String(error);
            log.error(`[NMEA Pool] Socket error on ${key}: ${message}`);
            const conn = entries.get(key);
            if (conn) {
                conn.isSocketConnected = false;
                conn.lastLoggedErrorMsg = message;
                conn.lastErrorLoggedTime = Date.now();
                for (const wsClient of conn.wsClients) {
                    if (wsClient.readyState !== 1)
                        continue;
                    try {
                        wsClient.send(JSON.stringify({ type: 'status', status: 'error', message }));
                    }
                    catch {
                        /* Client already gone. */
                    }
                }
            }
            try {
                socket.destroy();
            }
            catch {
                /* Already gone. */
            }
        });
        socket.on('close', () => {
            log.info(`[NMEA Pool] Connection closed for ${key}.`);
            stopWatchdog(key);
            const conn = entries.get(key);
            if (!conn)
                return;
            conn.isSocketConnected = false;
            if (conn.clients.size > 0 || conn.wsClients.size > 0 || keepAlive(key)) {
                scheduleReconnect(key);
            }
            else {
                entries.delete(key);
                timers.delete(key);
            }
        });
    }
    return {
        entries,
        establish(rawHost, port) {
            const key = `${normalizeHost(rawHost)}:${port}`;
            const existing = entries.get(key);
            if (existing)
                return existing;
            log.info(`[NMEA Pool] Establishing connection to ${key}.`);
            const socket = createConnection({ host: normalizeHost(rawHost), port: Number(port) }, () => {
                log.info(`[NMEA Pool] Connected to ${key}.`);
                const conn = entries.get(key);
                if (conn) {
                    conn.isSocketConnected = true;
                    conn.lastLoggedErrorMsg = '';
                }
                startWatchdog(key);
            });
            configureSocket(socket);
            const entry = newEntry(socket);
            entries.set(key, entry);
            attachHandlers(socket, key);
            return entry;
        },
        closeIfEmpty(key) {
            const conn = entries.get(key);
            if (!conn)
                return;
            if (conn.clients.size > 0 || conn.wsClients.size > 0)
                return;
            if (keepAlive(key))
                return;
            log.info(`[NMEA Pool] Nothing attached to ${key}. Closing.`);
            stopWatchdog(key);
            clearReconnectTimer(key);
            try {
                conn.socket.destroy();
            }
            catch {
                /* Already gone. */
            }
            entries.delete(key);
            timers.delete(key);
        },
        drop(key) {
            const conn = entries.get(key);
            if (!conn)
                return;
            stopWatchdog(key);
            clearReconnectTimer(key);
            for (const client of conn.clients) {
                try {
                    client.end();
                }
                catch {
                    /* Already gone. */
                }
            }
            for (const wsClient of conn.wsClients) {
                try {
                    wsClient.close();
                }
                catch {
                    /* Already gone. */
                }
            }
            conn.clients.clear();
            conn.wsClients.clear();
            conn.isSocketConnected = false;
            try {
                conn.socket.destroy();
            }
            catch {
                /* Already gone. */
            }
            entries.delete(key);
            timers.delete(key);
            log.info(`[NMEA Pool] Dropped ${key} because the configured address changed.`);
        },
        closeAll() {
            for (const key of [...entries.keys()])
                this.drop(key);
        },
    };
}
