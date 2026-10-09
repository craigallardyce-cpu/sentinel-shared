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

import { nmeaPoolKey, type NmeaProtocol } from './nmeaTarget.js';

/**
 * This package carries no Node or DOM types, so timers are taken from the host
 * explicitly rather than by widening the lib — the same approach as `backoff.ts`.
 */
const host = globalThis as unknown as {
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

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
  on(event: 'data', listener: (chunk: { toString(encoding: string): string } | string) => void): unknown;
  on(event: 'error', listener: (error: { message: string }) => void): unknown;
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
  on(
    event: 'message',
    listener: (message: { toString(encoding: string): string } | string, rinfo?: { address?: string; port?: number }) => void
  ): unknown;
  on(event: 'error', listener: (error: { message: string }) => void): unknown;
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
  createConnection(target: { host: string; port: number }, onConnect: () => void): NmeaSocketLike;
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
  establish(
    host: string | null | undefined,
    port: string | number,
    opts?: { transport?: NmeaProtocol }
  ): ConnectionPoolEntry;
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

interface Timers {
  watchdogInterval: unknown;
  watchdogCounter: number;
  reconnectTimer: unknown;
}

/** What a key was established as, so the reconnect path can repeat it. */
interface PoolTarget {
  transport: NmeaProtocol;
  /** For UDP this is the source-address filter, and may be empty. */
  host: string;
  port: number;
}

const SILENT: NmeaPoolLog = { info: () => {}, warn: () => {}, error: () => {} };

/** `[fe80::1]` and `fe80::1` are the same source; a pool key brackets, `rinfo` does not. */
function stripBrackets(value: string): string {
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
export function createNmeaPool(options: NmeaPoolOptions): NmeaPool {
  const {
    createConnection,
    createUdpSocket,
    watchdogSeconds = 8,
    reconnectDelayMs = 5000,
    connectTimeoutMs = 10000,
    onSentence,
    shouldKeepAlive,
    normalizeHost = (value: string) => value,
    log = SILENT,
  } = options;

  const entries = new Map<string, ConnectionPoolEntry>();
  const timers = new Map<string, Timers>();
  /*
    What each key was established as. The reconnect path used to recover the
    host and port by splitting the key, which stops being enough once a key can
    also be `udp:11102`: reconnecting has to know whether to dial or to rebind.
  */
  const targets = new Map<string, PoolTarget>();

  function getTimers(key: string): Timers {
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

  function keepAlive(key: string): boolean {
    if (!shouldKeepAlive) return false;
    try {
      return shouldKeepAlive(key);
    } catch (error) {
      /*
        The host's answer is unavailable, and the safe direction is unambiguous:
        assume a watch may be running rather than close the feed it depends on.
      */
      log.error(`[NMEA Pool] shouldKeepAlive failed for ${key}: ${(error as Error)?.message ?? error}`);
      return true;
    }
  }

  function broadcast(key: string, chunk: { toString(encoding: string): string } | string): void {
    const conn = entries.get(key);
    if (!conn) return;

    conn.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = conn.buffer.split(/\r?\n/);
    conn.buffer = lines.pop() ?? '';
    if (conn.buffer.length > MAX_PARTIAL_LINE) {
      log.warn(`[NMEA Pool] Discarded ${conn.buffer.length} characters with no line ending on ${key}.`);
      conn.buffer = '';
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || (!trimmed.startsWith('$') && !trimmed.startsWith('!'))) continue;

      // Serialised once per sentence, not once per client.
      const sse = `data: ${trimmed}\n\n`;
      for (const client of conn.clients) {
        try {
          client.write(sse);
        } catch {
          /* Client already gone; the close handler will remove it. */
        }
      }
      let wsPayload: string | null = null;
      for (const wsClient of conn.wsClients) {
        if (wsClient.readyState !== 1) continue;
        try {
          wsPayload ??= JSON.stringify({ type: 'nmea', sentence: trimmed });
          wsClient.send(wsPayload);
        } catch {
          /* As above. */
        }
      }

      if (onSentence) {
        try {
          onSentence(trimmed);
        } catch (error) {
          /*
            A consumer that throws must not take the stream down with it. This is
            HarborSentinel's live snapshot for the anchor watch: one bad sentence
            should cost that sentence, not the feed.
          */
          log.error(`[NMEA Pool] onSentence threw: ${(error as Error)?.message ?? error}`);
        }
      }
    }
  }

  function notify(key: string, sse: string, ws: Record<string, unknown>): void {
    const conn = entries.get(key);
    if (!conn) return;
    const wsPayload = JSON.stringify(ws);
    for (const client of conn.clients) {
      try {
        client.write(sse);
      } catch {
        /* Client already gone. */
      }
    }
    for (const wsClient of conn.wsClients) {
      if (wsClient.readyState !== 1) continue;
      try {
        wsClient.send(wsPayload);
      } catch {
        /* As above. */
      }
    }
  }

  function stopWatchdog(key: string): void {
    // `get`, not `getTimers`: stopping must not re-create the timers of a key
    // that drop or closeIfEmpty has just removed.
    const t = timers.get(key);
    if (!t) return;
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
  function startWatchdog(key: string): void {
    stopWatchdog(key);
    const t = getTimers(key);
    t.watchdogCounter = watchdogSeconds;

    t.watchdogInterval = host.setInterval(() => {
      t.watchdogCounter -= 1;
      if (t.watchdogCounter > 0) return;

      log.warn(`[NMEA Watchdog] No data for ${watchdogSeconds}s on ${key}. Reconnecting.`);
      stopWatchdog(key);

      // Destroy the socket but keep the entry, so attached clients survive.
      const conn = entries.get(key);
      if (conn) {
        try {
          conn.socket.destroy();
        } catch {
          /* Already gone. */
        }
      }
      scheduleReconnect(key);
    }, 1000);
  }

  function feedWatchdog(key: string): void {
    const t = timers.get(key);
    if (t) t.watchdogCounter = watchdogSeconds;
  }

  function clearReconnectTimer(key: string): void {
    const t = timers.get(key);
    if (!t) return;
    if (t.reconnectTimer) {
      host.clearTimeout(t.reconnectTimer);
      t.reconnectTimer = null;
    }
  }

  function scheduleReconnect(key: string): void {
    clearReconnectTimer(key);

    const target = targets.get(key);
    if (!target || !target.port) return;
    if (target.transport === 'tcp' && !target.host) return;

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
      } else {
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
  function dial(key: string, target: { host: string; port: number }, onConnect: () => void): NmeaSocketLike {
    let connected = false;
    let timer: unknown = null;
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
        } catch {
          /* Already gone. */
        }
      }, connectTimeoutMs);
      socket.on('close', clear);
    }
    return socket;
  }

  function attemptReconnect(key: string, targetHost: string, targetPort: number): void {
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
      } else {
        entries.set(key, newEntry(socket));
      }
      attachHandlers(socket, key);
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
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
  function configureSocket(socket: NmeaSocketLike): void {
    try {
      socket.setNoDelay?.(true);
      socket.setKeepAlive?.(true, 10000);
    } catch {
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
  function udpAdapter(socket: NmeaUdpSocketLike, filterHost: string): NmeaSocketLike {
    const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    const wanted = stripBrackets(filterHost);

    socket.on('message', (message, rinfo) => {
      if (wanted && rinfo?.address && stripBrackets(rinfo.address) !== wanted) return;
      const text = typeof message === 'string' ? message : message.toString('utf8');
      const terminated = text.endsWith('\n') ? text : `${text}\r\n`;
      for (const listener of listeners.data ?? []) (listener as (chunk: string) => void)(terminated);
    });
    socket.on('error', (error) => {
      for (const listener of listeners.error ?? []) (listener as (e: { message: string }) => void)(error);
    });
    socket.on('close', () => {
      for (const listener of listeners.close ?? []) (listener as () => void)();
    });

    return {
      on(event: string, listener: (arg?: unknown) => void) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      destroy() {
        try {
          socket.close();
        } catch {
          /*
            dgram throws rather than no-oping on a socket that never bound —
            the EADDRINUSE path. No 'close' will follow, and the pool's whole
            recovery hangs off that event, so emit it rather than going quiet.
          */
          for (const listener of listeners.close ?? []) (listener as () => void)();
        }
      },
    } as NmeaSocketLike;
  }

  /** Bind a fresh UDP socket for a key, and wire it up exactly as a TCP one. */
  function openUdp(key: string, target: PoolTarget, onBound?: () => void): NmeaSocketLike {
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
  function attemptRebind(key: string, target: PoolTarget): void {
    log.info(`[NMEA Pool] Rebinding ${key}.`);
    try {
      const socket = openUdp(key, target, () =>
        notify(key, 'event: reconnected\ndata: Connection restored\n\n', {
          type: 'status',
          status: 'connected',
          message: 'Connection restored',
        })
      );
      const existing = entries.get(key);
      if (existing) {
        existing.socket = socket;
        existing.buffer = '';
      } else {
        entries.set(key, newEntry(socket));
      }
      attachHandlers(socket, key);
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      log.error(`[NMEA Pool] Rebinding ${key} failed: ${message}`);
      const conn = entries.get(key);
      if (conn) {
        conn.isSocketConnected = false;
        conn.lastLoggedErrorMsg = message;
      }
      scheduleReconnect(key);
    }
  }

  function newEntry(socket: NmeaSocketLike): ConnectionPoolEntry {
    return {
      socket,
      clients: new Set<SseClientLike>(),
      wsClients: new Set<WsClientLike>(),
      buffer: '',
      isSocketConnected: false,
      lastLoggedErrorMsg: '',
      lastErrorLoggedTime: 0,
    };
  }

  function attachHandlers(socket: NmeaSocketLike, key: string): void {
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
      if (!isCurrent()) return;
      feedWatchdog(key);
      broadcast(key, chunk);
    });

    socket.on('error', (error) => {
      if (!isCurrent()) {
        try {
          socket.destroy();
        } catch {
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
          if (wsClient.readyState !== 1) continue;
          try {
            wsClient.send(JSON.stringify({ type: 'status', status: 'error', message }));
          } catch {
            /* Client already gone. */
          }
        }
      }
      try {
        socket.destroy();
      } catch {
        /* Already gone. */
      }
    });

    socket.on('close', () => {
      if (!isCurrent()) return;
      log.info(`[NMEA Pool] Connection closed for ${key}.`);
      stopWatchdog(key);

      const conn = entries.get(key);
      if (!conn) return;
      conn.isSocketConnected = false;

      if (conn.clients.size > 0 || conn.wsClients.size > 0 || keepAlive(key)) {
        scheduleReconnect(key);
      } else {
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
      const transport: NmeaProtocol = opts?.transport === 'udp' ? 'udp' : 'tcp';
      // A UDP listener may have no host at all; a TCP one always does, and
      // normalizeHost has always been applied before the key is built.
      const resolvedHost = rawHost ? normalizeHost(rawHost) : '';
      const key = nmeaPoolKey({ host: resolvedHost, port, protocol: transport });
      const existing = entries.get(key);
      if (existing) return existing;

      const target: PoolTarget = { transport, host: resolvedHost, port: Number(port) };
      targets.set(key, target);

      if (transport === 'udp') {
        log.info(`[NMEA Pool] Listening for NMEA on ${key}.`);
        let socket: NmeaSocketLike;
        try {
          socket = openUdp(key, target);
        } catch (error) {
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
      let socket: NmeaSocketLike;
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
      } catch (error) {
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
      if (!conn) return;
      if (conn.clients.size > 0 || conn.wsClients.size > 0) return;
      if (keepAlive(key)) return;

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
      } catch {
        /* Already gone. */
      }
    },

    drop(key) {
      const conn = entries.get(key);
      if (!conn) return;

      stopWatchdog(key);
      clearReconnectTimer(key);

      for (const client of conn.clients) {
        try {
          client.end();
        } catch {
          /* Already gone. */
        }
      }
      for (const wsClient of conn.wsClients) {
        try {
          wsClient.close();
        } catch {
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
      } catch {
        /* Already gone. */
      }
      log.info(`[NMEA Pool] Dropped ${key} because the configured address changed.`);
    },

    closeAll() {
      for (const key of [...entries.keys()]) this.drop(key);
    },
  };
}

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
export function listenForNmea(options: ListenForNmeaOptions): Promise<ListenForNmeaResult> {
  // Not destructured as `host`: that is the module's timer host, and shadowing
  // it here would take `setTimeout` with it.
  const { createUdpSocket, port, timeoutMs = 4000 } = options;
  const wanted = stripBrackets(String(options.host ?? ''));

  return new Promise<ListenForNmeaResult>((resolve, reject) => {
    let heard = 0;
    let sample: string | undefined;
    let settled = false;
    let timer: unknown = null;
    const socket = createUdpSocket();

    const stop = (finish: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) host.clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* Never bound, or already closed. */
      }
      finish();
    };

    socket.on('message', (message, rinfo) => {
      if (wanted && rinfo?.address && stripBrackets(rinfo.address) !== wanted) return;
      const text = typeof message === 'string' ? message : message.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || (!trimmed.startsWith('$') && !trimmed.startsWith('!'))) continue;
        heard += 1;
        sample ??= trimmed;
      }
    });

    socket.on('error', (error) => {
      stop(() => reject(error instanceof Error ? error : new Error(error?.message ?? String(error))));
    });

    timer = host.setTimeout(() => stop(() => resolve(sample === undefined ? { heard } : { heard, sample })), timeoutMs);

    try {
      socket.bind(Number(port));
    } catch (error) {
      stop(() => reject(error as Error));
    }
  });
}
