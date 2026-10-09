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
import { type NmeaProtocol } from './nmeaTarget.js';
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
/**
 * The subset of a bound UDP socket this pool uses, modelled on Node's `dgram`.
 *
 * The caller creates it — `dgram.createSocket({ type: 'udp4', reuseAddr: true })`
 * — because `reuseAddr` is a creation option and because this package must not
 * import `dgram`. `reuseAddr` is not optional in practice: without it, the
 * second app on one boat PC cannot bind the port the first one is listening on,
 * which would reintroduce the single-listener limit UDP is here to remove.
 *
 * One thing that follows from the sockets and not from this code, verified on
 * Linux with real `dgram` sockets: two sockets bound to one port with
 * `reuseAddr` both receive a BROADCAST datagram, and only one of them receives
 * a UNICAST one. A gateway that broadcasts — which is the configuration this
 * transport exists for — therefore feeds every app on the PC. A gateway
 * configured to send to one address does not, and the second app will sit
 * silent with a perfectly healthy socket. Worth knowing before blaming this
 * pool for a feed that reaches one app of two.
 */
export interface NmeaUdpSocketLike {
    bind(port: number, onListening?: () => void): unknown;
    on(event: 'message', listener: (message: {
        toString(encoding: string): string;
    } | string, rinfo?: {
        address?: string;
        port?: number;
    }) => void): unknown;
    on(event: 'error', listener: (error: {
        message: string;
    }) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    close(): unknown;
    /**
     * Declared because `dgram` has it and a caller may want it set; the pool does
     * not call it. Receiving a broadcast needs nothing but a bound port —
     * `setBroadcast` governs SENDING to a broadcast address, and this pool only
     * ever listens.
     */
    setBroadcast?(flag: boolean): unknown;
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
    /**
     * Create an unbound UDP socket, for `establish(..., { transport: 'udp' })`.
     * Injected for the same reason `createConnection` is. Omit it and the pool is
     * TCP-only, which is what every caller was before this existed.
     */
    createUdpSocket?(): NmeaUdpSocketLike;
    /** Seam 1. Silence for this long triggers a reconnect. OpenCPN's N_DOG_TIMEOUT. */
    watchdogSeconds?: number;
    /** Seam 1. Fixed delay between reconnection attempts; the pool never gives up. */
    reconnectDelayMs?: number;
    /**
     * How long a TCP dial may take before the socket is destroyed and the usual
     * close-and-reconnect path takes over. Without it a gateway that silently
     * drops the connection attempt leaves the OS's own connect timeout (minutes)
     * in charge, and the watchdog never starts because it starts on connect. UDP
     * has no connect step and ignores this. Default 10000.
     */
    connectTimeoutMs?: number;
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
    /** The live pool, keyed `host:port` for TCP and `udp:[host:]port` for UDP. */
    readonly entries: Map<string, ConnectionPoolEntry>;
    /**
     * Open a connection, or return the one already open for this target.
     *
     * With `{ transport: 'udp' }` this binds the port on all interfaces and
     * listens instead of dialling; `host` is then an optional filter on the
     * source address (pass `''` or null to accept from anywhere) rather than
     * somewhere to connect to.
     */
    establish(host: string | null | undefined, port: string | number, opts?: {
        transport?: NmeaProtocol;
    }): ConnectionPoolEntry;
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
/** What `listenForNmea` needs to answer "is anything out there". */
export interface ListenForNmeaOptions {
    /** Same injected factory as the pool's, and the same `reuseAddr` expectation. */
    createUdpSocket(): NmeaUdpSocketLike;
    port: string | number;
    /** Count only datagrams from this source. Absent means any. */
    host?: string | null;
    /** How long to listen. Long enough for a 1 Hz gateway to say something. */
    timeoutMs?: number;
}
export interface ListenForNmeaResult {
    /** Sentences seen in the window. Zero is the answer the dialog exists to give. */
    heard: number;
    /** The first one, so the dialog can show what arrived rather than just a count. */
    sample?: string;
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
export declare function listenForNmea(options: ListenForNmeaOptions): Promise<ListenForNmeaResult>;
