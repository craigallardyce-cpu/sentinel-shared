"use strict";
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
 *
 * **UDP is a second transport, not a second pool.** A gateway that broadcasts
 * has no client slot to contend for, so any number of devices can listen to the
 * same feed — which is the point of offering it. Everything downstream of the
 * bytes is unchanged: the same line splitting, the same `$`/`!` filter, the same
 * fan-out, and the same watchdog, which rebinds on silence exactly as it
 * reconnects. The socket is injected like `createConnection` is, so Node's
 * `dgram` never becomes an import of this package and a browser bundle never
 * sees it. Entries are keyed `udp:<port>` or `udp:<host>:<port>` so a UDP
 * listener and a TCP connection on one port cannot collide.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNmeaPool = createNmeaPool;
exports.listenForNmea = listenForNmea;
const nmeaTarget_js_1 = require("./nmeaTarget.js");
/**
 * This package carries no Node or DOM types, so timers are taken from the host
 * explicitly rather than by widening the lib — the same approach as `backoff.ts`.
 */
const host = globalThis;
const SILENT = { info: () => { }, warn: () => { }, error: () => { } };
/** `[fe80::1]` and `fe80::1` are the same source; a pool key brackets, `rinfo` does not. */
function stripBrackets(value) {
    const trimmed = value.trim();
    return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
}
/**
 * A factory, not module-level state.
 *
 * Harbor's copy held the pool, the timers and the "current" host and port in
 * module scope, which means two hosts in one process share one pool and quietly
 * fight over it. Nothing needs that, and a test certainly does not.
 */
function createNmeaPool(options) {
    const { createConnection, createUdpSocket, watchdogSeconds = 8, reconnectDelayMs = 5000, connectTimeoutMs = 10000, onSentence, shouldKeepAlive, normalizeHost = (value) => value, log = SILENT, } = options;
    const entries = new Map();
    const timers = new Map();
    /*
      What each key was established as. The reconnect path used to recover the
      host and port by splitting the key, which stops being enough once a key can
      also be `udp:11102`: reconnecting has to know whether to dial or to rebind.
    */
    const targets = new Map();
    function getTimers(key) {
        let found = timers.get(key);
        if (!found) {
            found = { watchdogInterval: null, watchdogCounter: 0, reconnectTimer: null };
            timers.set(key, found);
        }
        return found;
    }
    /**
     * A partial line longer than this is not a sentence on its way: NMEA 0183
     * caps one at 82 characters. It is a source sending something without line
     * endings, and holding on to it would grow without bound.
     */
    const MAX_PARTIAL_LINE = 8192;
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
        if (conn.buffer.length > MAX_PARTIAL_LINE) {
            log.warn(`[NMEA Pool] Discarded ${conn.buffer.length} characters with no line ending on ${key}.`);
            conn.buffer = '';
        }
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || (!trimmed.startsWith('$') && !trimmed.startsWith('!')))
                continue;
            // Serialised once per sentence, not once per client.
            const sse = `data: ${trimmed}\n\n`;
            for (const client of conn.clients) {
                try {
                    client.write(sse);
                }
                catch {
                    /* Client already gone; the close handler will remove it. */
                }
            }
            let wsPayload = null;
            for (const wsClient of conn.wsClients) {
                if (wsClient.readyState !== 1)
                    continue;
                try {
                    wsPayload ?? (wsPayload = JSON.stringify({ type: 'nmea', sentence: trimmed }));
                    wsClient.send(wsPayload);
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
        const wsPayload = JSON.stringify(ws);
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
                wsClient.send(wsPayload);
            }
            catch {
                /* As above. */
            }
        }
    }
    function stopWatchdog(key) {
        // `get`, not `getTimers`: stopping must not re-create the timers of a key
        // that drop or closeIfEmpty has just removed.
        const t = timers.get(key);
        if (!t)
            return;
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
        const t = timers.get(key);
        if (t)
            t.watchdogCounter = watchdogSeconds;
    }
    function clearReconnectTimer(key) {
        const t = timers.get(key);
        if (!t)
            return;
        if (t.reconnectTimer) {
            host.clearTimeout(t.reconnectTimer);
            t.reconnectTimer = null;
        }
    }
    function scheduleReconnect(key) {
        clearReconnectTimer(key);
        const target = targets.get(key);
        if (!target || !target.port)
            return;
        if (target.transport === 'tcp' && !target.host)
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
            if (target.transport === 'udp') {
                attemptRebind(key, target);
            }
            else {
                attemptReconnect(key, target.host, target.port);
            }
        }, reconnectDelayMs);
    }
    /**
     * Dial, and give up on the dial after `connectTimeoutMs`.
     *
     * Giving up is a `destroy()`, so what follows is the same close (and, with
     * clients or a watch attached, the same reconnect) as any other failed
     * connection; there is no second recovery path to keep in step.
     */
    function dial(key, target, onConnect) {
        let connected = false;
        let timer = null;
        const clear = () => {
            if (timer) {
                host.clearTimeout(timer);
                timer = null;
            }
        };
        const socket = createConnection(target, () => {
            connected = true;
            clear();
            onConnect();
        });
        if (!connected) {
            timer = host.setTimeout(() => {
                timer = null;
                log.warn(`[NMEA Pool] No connection to ${key} after ${connectTimeoutMs}ms. Abandoning this attempt.`);
                try {
                    socket.destroy();
                }
                catch {
                    /* Already gone. */
                }
            }, connectTimeoutMs);
            socket.on('close', clear);
        }
        return socket;
    }
    function attemptReconnect(key, targetHost, targetPort) {
        log.info(`[NMEA Pool] Attempting reconnection to ${key}.`);
        try {
            const socket = dial(key, { host: targetHost, port: targetPort }, () => {
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
    /**
     * A bound UDP socket, dressed as the TCP socket the rest of this file knows.
     *
     * Everything past the bytes — the watchdog, the fan-out, the close and
     * reconnect handling — is transport-independent already, and the way to keep
     * it that way is one adapter rather than a second copy of all of it with
     * `message` where `data` used to be.
     *
     * Two things the adapter decides:
     *
     * 1. **A datagram ends a sentence.** The stream path holds an unterminated
     *    tail until the rest of it arrives, which is right for TCP and wrong
     *    here: UDP has no continuity between datagrams, so a retained tail would
     *    be spliced onto whatever unrelated datagram came next — the same defect
     *    as the AIS fragment splice. Appending the terminator when a datagram
     *    lacks one keeps the same line splitting and the same `$`/`!` filter
     *    while making the buffer always empty at the end of a datagram. A
     *    truncated sentence is then emitted whole and fails its checksum
     *    downstream, which is the safe way to be wrong.
     * 2. **A source filter, when one was configured.** A datagram from any other
     *    address is dropped. A socket that reports no `rinfo` cannot be checked,
     *    and is trusted rather than silenced — the filter is there to keep two
     *    gateways on one LAN apart, not to be a security boundary.
     */
    function udpAdapter(socket, filterHost) {
        const listeners = {};
        const wanted = stripBrackets(filterHost);
        socket.on('message', (message, rinfo) => {
            if (wanted && rinfo?.address && stripBrackets(rinfo.address) !== wanted)
                return;
            const text = typeof message === 'string' ? message : message.toString('utf8');
            const terminated = text.endsWith('\n') ? text : `${text}\r\n`;
            for (const listener of listeners.data ?? [])
                listener(terminated);
        });
        socket.on('error', (error) => {
            for (const listener of listeners.error ?? [])
                listener(error);
        });
        socket.on('close', () => {
            for (const listener of listeners.close ?? [])
                listener();
        });
        return {
            on(event, listener) {
                (listeners[event] ?? (listeners[event] = [])).push(listener);
                return this;
            },
            destroy() {
                try {
                    socket.close();
                }
                catch {
                    /*
                      dgram throws rather than no-oping on a socket that never bound —
                      the EADDRINUSE path. No 'close' will follow, and the pool's whole
                      recovery hangs off that event, so emit it rather than going quiet.
                    */
                    for (const listener of listeners.close ?? [])
                        listener();
                }
            },
        };
    }
    /** Bind a fresh UDP socket for a key, and wire it up exactly as a TCP one. */
    function openUdp(key, target, onBound) {
        if (!createUdpSocket) {
            throw new Error('[NMEA Pool] UDP was requested but no createUdpSocket was injected.');
        }
        const raw = createUdpSocket();
        const adapter = udpAdapter(raw, target.host);
        // All interfaces: a broadcast arrives on whichever one faces the gateway,
        // and on a boat that is rarely the one an address would have named.
        raw.bind(target.port, () => {
            log.info(`[NMEA Pool] Listening on ${key}.`);
            const conn = entries.get(key);
            if (conn) {
                conn.isSocketConnected = true;
                conn.lastLoggedErrorMsg = '';
            }
            startWatchdog(key);
            onBound?.();
        });
        return adapter;
    }
    /** The UDP half of `attemptReconnect`: silence means rebind, not redial. */
    function attemptRebind(key, target) {
        log.info(`[NMEA Pool] Rebinding ${key}.`);
        try {
            const socket = openUdp(key, target, () => notify(key, 'event: reconnected\ndata: Connection restored\n\n', {
                type: 'status',
                status: 'connected',
                message: 'Connection restored',
            }));
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
            log.error(`[NMEA Pool] Rebinding ${key} failed: ${message}`);
            const conn = entries.get(key);
            if (conn) {
                conn.isSocketConnected = false;
                conn.lastLoggedErrorMsg = message;
            }
            scheduleReconnect(key);
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
        /*
          A socket's events speak for its key only while it is still that key's
          socket. Once closeIfEmpty or drop has removed the entry, or a reconnect or
          a fresh establish has put another socket in it, a late event from the old
          one must not touch the new entry: its close would stop the new watchdog
          and could delete the entry outright. Every path assigns the entry's socket
          before calling this, so the check holds from the first event. During a
          watchdog trip the entry keeps the destroyed socket until the reconnect
          fires, so that socket's close is still current, as it must be.
        */
        const isCurrent = () => entries.get(key)?.socket === socket;
        socket.on('data', (chunk) => {
            if (!isCurrent())
                return;
            feedWatchdog(key);
            broadcast(key, chunk);
        });
        socket.on('error', (error) => {
            if (!isCurrent()) {
                try {
                    socket.destroy();
                }
                catch {
                    /* Already gone. */
                }
                return;
            }
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
            if (!isCurrent())
                return;
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
                // A reconnect scheduled earlier (by the watchdog, say) would otherwise
                // fire after this and resurrect an entry with no target behind it.
                clearReconnectTimer(key);
                entries.delete(key);
                timers.delete(key);
                targets.delete(key);
            }
        });
    }
    return {
        entries,
        establish(rawHost, port, opts) {
            const transport = opts?.transport === 'udp' ? 'udp' : 'tcp';
            // A UDP listener may have no host at all; a TCP one always does, and
            // normalizeHost has always been applied before the key is built.
            const resolvedHost = rawHost ? normalizeHost(rawHost) : '';
            const key = (0, nmeaTarget_js_1.nmeaPoolKey)({ host: resolvedHost, port, protocol: transport });
            const existing = entries.get(key);
            if (existing)
                return existing;
            const target = { transport, host: resolvedHost, port: Number(port) };
            targets.set(key, target);
            if (transport === 'udp') {
                log.info(`[NMEA Pool] Listening for NMEA on ${key}.`);
                let socket;
                try {
                    socket = openUdp(key, target);
                }
                catch (error) {
                    // No socket means no entry to hang a reconnect off, so the failure
                    // has to reach the caller rather than being retried into silence.
                    targets.delete(key);
                    throw error;
                }
                const udpEntry = newEntry(socket);
                entries.set(key, udpEntry);
                attachHandlers(socket, key);
                return udpEntry;
            }
            log.info(`[NMEA Pool] Establishing connection to ${key}.`);
            let socket;
            try {
                socket = dial(key, { host: resolvedHost, port: Number(port) }, () => {
                    log.info(`[NMEA Pool] Connected to ${key}.`);
                    const conn = entries.get(key);
                    if (conn) {
                        conn.isSocketConnected = true;
                        conn.lastLoggedErrorMsg = '';
                    }
                    startWatchdog(key);
                });
            }
            catch (error) {
                // As for UDP above: no socket means no entry, so the caller hears of it.
                targets.delete(key);
                throw error;
            }
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
            // Forget the key before destroying: a socket may emit 'close'
            // synchronously from destroy() (the UDP adapter does), and that event
            // must find nothing current to act on.
            entries.delete(key);
            timers.delete(key);
            targets.delete(key);
            try {
                conn.socket.destroy();
            }
            catch {
                /* Already gone. */
            }
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
            // Before destroy(), for the reason closeIfEmpty gives.
            entries.delete(key);
            timers.delete(key);
            targets.delete(key);
            try {
                conn.socket.destroy();
            }
            catch {
                /* Already gone. */
            }
            log.info(`[NMEA Pool] Dropped ${key} because the configured address changed.`);
        },
        closeAll() {
            for (const key of [...entries.keys()])
                this.drop(key);
        },
    };
}
/**
 * Listen on a UDP port for a fixed window and report what arrived.
 *
 * The settings dialogs' "test" button has nothing to test under UDP: there is
 * no connection to make, so the question "did it work" can only be answered by
 * whether any sentences turn up. Binding briefly and counting them is that
 * answer, and it is deliberately not the pool — a test button must not leave an
 * entry behind, and it must stop on its own.
 *
 * A sentence is counted on the same terms the pool broadcasts one: a line
 * beginning `$` or `!`. No checksum is verified, so a gateway sending slightly
 * malformed sentences still reads as present rather than as absent, which is
 * the more useful failure to distinguish here.
 *
 * Errors REJECT rather than resolving with zero: a port already held by
 * something that is not sharing it is a different problem from a quiet gateway,
 * and the dialog should be able to say which.
 */
function listenForNmea(options) {
    // Not destructured as `host`: that is the module's timer host, and shadowing
    // it here would take `setTimeout` with it.
    const { createUdpSocket, port, timeoutMs = 4000 } = options;
    const wanted = stripBrackets(String(options.host ?? ''));
    return new Promise((resolve, reject) => {
        let heard = 0;
        let sample;
        let settled = false;
        let timer = null;
        const socket = createUdpSocket();
        const stop = (finish) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                host.clearTimeout(timer);
            try {
                socket.close();
            }
            catch {
                /* Never bound, or already closed. */
            }
            finish();
        };
        socket.on('message', (message, rinfo) => {
            if (wanted && rinfo?.address && stripBrackets(rinfo.address) !== wanted)
                return;
            const text = typeof message === 'string' ? message : message.toString('utf8');
            for (const line of text.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || (!trimmed.startsWith('$') && !trimmed.startsWith('!')))
                    continue;
                heard += 1;
                sample ?? (sample = trimmed);
            }
        });
        socket.on('error', (error) => {
            stop(() => reject(error instanceof Error ? error : new Error(error?.message ?? String(error))));
        });
        timer = host.setTimeout(() => stop(() => resolve(sample === undefined ? { heard } : { heard, sample })), timeoutMs);
        try {
            socket.bind(Number(port));
        }
        catch (error) {
            stop(() => reject(error));
        }
    });
}
