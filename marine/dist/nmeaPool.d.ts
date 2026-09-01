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
/** Anything that can be written to as a Server-Sent Events response. */
export interface SseClientLike {
    write(chunk: string): unknown;
    end(): unknown;
}
/** Anything WebSocket-shaped. `readyState` 1 is OPEN, as in every implementation. */
export interface WsClientLike {
    readonly readyState: number;
    send(data: string): unknown;
    close(): unknown;
}
/** The subset of a TCP socket this pool uses. */
export interface NmeaSocketLike {
    on(event: 'data', listener: (chunk: {
        toString(encoding: string): string;
    } | string) => void): unknown;
    on(event: 'error', listener: (error: {
        message: string;
    }) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    destroy(): unknown;
    setNoDelay?(noDelay: boolean): unknown;
    setKeepAlive?(enable: boolean, initialDelayMs: number): unknown;
}
export interface ConnectionPoolEntry {
    socket: NmeaSocketLike;
    clients: Set<SseClientLike>;
    wsClients: Set<WsClientLike>;
    buffer: string;
    /** Seam 4: carried for both apps rather than maintaining two entry shapes. */
    isSocketConnected: boolean;
    lastLoggedErrorMsg: string;
    lastErrorLoggedTime: number;
}
export interface NmeaPoolLog {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
export interface NmeaPoolOptions {
    /** Open a TCP socket. Injected so this package needs no Node types. */
    createConnection(target: {
        host: string;
        port: number;
    }, onConnect: () => void): NmeaSocketLike;
    /** Seam 1. Silence for this long triggers a reconnect. OpenCPN's N_DOG_TIMEOUT. */
    watchdogSeconds?: number;
    /** Seam 1. Fixed delay between reconnection attempts; the pool never gives up. */
    reconnectDelayMs?: number;
    /** Seam 2. Every complete sentence, before it is broadcast. */
    onSentence?(sentence: string): void;
    /**
     * Seam 3. Return true to refuse a close that would otherwise happen because the
     * last client left. HarborSentinel answers true while an anchor watch is
     * running, so a closed browser tab cannot end a boat's drag alarm.
     */
    shouldKeepAlive?(key: string): boolean;
    /** Applied to a host before it becomes part of a pool key. */
    normalizeHost?(host: string): string;
    /** Defaults to no logging at all, which is what a test wants. */
    log?: NmeaPoolLog;
}
export interface NmeaPool {
    /** The live pool, keyed `host:port`. */
    readonly entries: Map<string, ConnectionPoolEntry>;
    /** Open a connection, or return the one already open for this target. */
    establish(host: string, port: string | number): ConnectionPoolEntry;
    /** Close if nothing is attached and `shouldKeepAlive` does not object. */
    closeIfEmpty(key: string): void;
    /**
     * Close outright, whatever is attached.
     *
     * Distinct from `closeIfEmpty`, which declines while a watch is running. That
     * reluctance is right for its own job and exactly wrong here: this is called
     * when the configured gateway has CHANGED, so the socket being protected points
     * at an address the navigator has just stopped using, and keeping it alive would
     * mean an anchor watch quietly running on the old device.
     *
     * Clients are dropped rather than migrated. Each reconnects on its own and is
     * handed the newly configured target on the way back in, which keeps the
     * reconnect path the single one that is exercised constantly rather than
     * inventing a second one used only here.
     */
    drop(key: string): void;
    /** Close everything. For shutdown. */
    closeAll(): void;
}
/**
 * A factory, not module-level state.
 *
 * Harbor's copy held the pool, the timers and the "current" host and port in
 * module scope, which means two hosts in one process share one pool and quietly
 * fight over it. Nothing needs that, and a test certainly does not.
 */
export declare function createNmeaPool(options: NmeaPoolOptions): NmeaPool;
