import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNmeaPool, listenForNmea } from '../src/nmeaPool.js';
import type { NmeaSocketLike, NmeaUdpSocketLike, SseClientLike, WsClientLike } from '../src/nmeaPool.js';

/**
 * The guarantees both apps depend on, and none of which was asserted anywhere
 * before this file existed.
 *
 * This is the anchor watch's data path: every position fix a drag alarm evaluates
 * arrives through it. A regression here does not show up as a broken page, it
 * shows up as a watch that stops noticing the boat has moved.
 *
 * The socket is a stub rather than a real TCP server, which is what injecting
 * `createConnection` buys — the tests drive `data`, `error` and `close` directly
 * and never depend on a port being free.
 */

/** A socket whose events a test fires by hand. */
function stubSocket() {
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  let destroyed = false;
  const socket: NmeaSocketLike & {
    fire(event: string, arg?: unknown): void;
    readonly destroyed: boolean;
    noDelay: boolean;
    keepAlive: boolean;
  } = {
    on(event: string, listener: (arg?: unknown) => void) {
      (handlers[event] ??= []).push(listener);
      return socket;
    },
    destroy() {
      destroyed = true;
    },
    setNoDelay(value: boolean) {
      socket.noDelay = value;
    },
    setKeepAlive(enable: boolean) {
      socket.keepAlive = enable;
    },
    fire(event, arg) {
      for (const listener of handlers[event] ?? []) listener(arg);
    },
    get destroyed() {
      return destroyed;
    },
    noDelay: false,
    keepAlive: false,
  } as never;
  return socket;
}

function sseClient() {
  const written: string[] = [];
  let ended = false;
  const client: SseClientLike & { written: string[]; readonly ended: boolean } = {
    write: (chunk: string) => void written.push(chunk),
    end: () => {
      ended = true;
    },
    written,
    get ended() {
      return ended;
    },
  } as never;
  return client;
}

function wsClient(readyState = 1) {
  const sent: string[] = [];
  let closed = false;
  const client: WsClientLike & { sent: string[]; readonly closed: boolean } = {
    readyState,
    send: (data: string) => void sent.push(data),
    close: () => {
      closed = true;
    },
    sent,
    get closed() {
      return closed;
    },
  } as never;
  return client;
}

/**
 * A bound UDP socket whose datagrams a test delivers by hand.
 *
 * Same trade as the TCP stub: nothing here needs a free port, and `dgram` never
 * becomes an import of this package. `bind` records the port and calls back on
 * the next tick, as the real one does.
 */
function stubUdpSocket() {
  const handlers: Record<string, Array<(...args: never[]) => void>> = {};
  const socket = {
    bound: null as number | null,
    closed: false,
    broadcast: false,
    /** Set to throw on close, for the socket that never bound. */
    closeThrows: false,
    bind(port: number, onListening?: () => void) {
      socket.bound = port;
      if (onListening) queueMicrotask(onListening);
      return socket;
    },
    on(event: string, listener: (...args: never[]) => void) {
      (handlers[event] ??= []).push(listener);
      return socket;
    },
    close() {
      if (socket.closeThrows) throw new Error('Not running');
      socket.closed = true;
      for (const listener of handlers.close ?? []) (listener as () => void)();
      return socket;
    },
    setBroadcast(flag: boolean) {
      socket.broadcast = flag;
      return socket;
    },
    /** Deliver a datagram. `from` is the source address, as `rinfo` carries it. */
    send(text: string, from?: string) {
      for (const listener of handlers.message ?? []) {
        (listener as (m: string, r?: { address?: string }) => void)(text, from ? { address: from } : undefined);
      }
    },
    fail(message: string) {
      for (const listener of handlers.error ?? []) (listener as (e: { message: string }) => void)({ message });
    },
  };
  return socket as typeof socket & NmeaUdpSocketLike;
}

function makeUdpPool(options: Partial<Parameters<typeof createNmeaPool>[0]> = {}) {
  const udpSockets: ReturnType<typeof stubUdpSocket>[] = [];
  const pool = createNmeaPool({
    createConnection: () => {
      throw new Error('This pool is UDP-only in this test.');
    },
    createUdpSocket: () => {
      const socket = stubUdpSocket();
      udpSockets.push(socket);
      return socket;
    },
    ...options,
  });
  return { pool, udpSockets };
}

function makePool(options: Partial<Parameters<typeof createNmeaPool>[0]> = {}) {
  const sockets: ReturnType<typeof stubSocket>[] = [];
  const connects: Array<{ host: string; port: number }> = [];
  const pool = createNmeaPool({
    createConnection: (target, onConnect) => {
      connects.push(target);
      const socket = stubSocket();
      sockets.push(socket);
      // Connected on the next tick, as a real socket is.
      queueMicrotask(onConnect);
      return socket;
    },
    ...options,
  });
  return { pool, sockets, connects };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a client attaches and receives sentences', () => {
  it('splits a stream into complete sentences and fans them out', async () => {
    const { pool, sockets } = makePool();
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    const ws = wsClient();
    entry.clients.add(sse);
    entry.wsClients.add(ws);

    sockets[0].fire('data', '$GPRMC,one*00\r\n$GPRMC,two*00\r\n');

    expect(sse.written).toEqual(['data: $GPRMC,one*00\n\n', 'data: $GPRMC,two*00\n\n']);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'nmea', sentence: '$GPRMC,one*00' });
  });

  it('holds a partial sentence until the rest of it arrives', async () => {
    // TCP does not deliver on line boundaries, and half a sentence delivered as a
    // whole one is a fix with a truncated longitude.
    const { pool, sockets } = makePool();
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    entry.clients.add(sse);

    sockets[0].fire('data', '$GPRMC,par');
    expect(sse.written).toEqual([]);

    sockets[0].fire('data', 'tial*00\r\n');
    expect(sse.written).toEqual(['data: $GPRMC,partial*00\n\n']);
  });

  it('ignores anything that is not a sentence', async () => {
    const { pool, sockets } = makePool();
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    entry.clients.add(sse);

    sockets[0].fire('data', 'garbage\r\n$GPRMC,ok*00\r\n!AIVDM,1*00\r\n');

    expect(sse.written).toEqual(['data: $GPRMC,ok*00\n\n', 'data: !AIVDM,1*00\n\n']);
  });

  it('skips a WebSocket client that is not open', async () => {
    const { pool, sockets } = makePool();
    const entry = pool.establish('10.10.10.1', 11102);
    const closing = wsClient(2);
    entry.wsClients.add(closing);

    sockets[0].fire('data', '$GPRMC,ok*00\r\n');

    expect(closing.sent).toEqual([]);
  });
});

describe('a second client shares the socket', () => {
  it('opens one connection for one target', () => {
    const { pool, connects } = makePool();
    const first = pool.establish('10.10.10.1', 11102);
    const second = pool.establish('10.10.10.1', 11102);

    expect(second).toBe(first);
    expect(connects).toHaveLength(1);
  });

  it('opens a separate connection for a different target', () => {
    const { pool, connects } = makePool();
    pool.establish('10.10.10.1', 11102);
    pool.establish('192.168.1.5', 10110);

    expect(connects).toHaveLength(2);
    expect([...pool.entries.keys()]).toEqual(['10.10.10.1:11102', '192.168.1.5:10110']);
  });
});

describe('the watchdog', () => {
  it('fires after silence and reconnects, even though the socket looks fine', async () => {
    // The case it exists for: a half-open TCP connection reports nothing wrong
    // and delivers nothing either.
    const { pool, sockets, connects } = makePool({ watchdogSeconds: 8, reconnectDelayMs: 5000 });
    pool.establish('10.10.10.1', 11102);
    await vi.advanceTimersByTimeAsync(0); // let onConnect run and start the watchdog

    await vi.advanceTimersByTimeAsync(8000);
    expect(sockets[0].destroyed).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(connects).toHaveLength(2);
    expect(connects[1]).toEqual({ host: '10.10.10.1', port: 11102 });
  });

  it('is fed by data, so a live stream never trips it', async () => {
    const { pool, sockets, connects } = makePool({ watchdogSeconds: 8 });
    pool.establish('10.10.10.1', 11102);
    await vi.advanceTimersByTimeAsync(0);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      sockets[0].fire('data', '$GPRMC,alive*00\r\n');
    }

    expect(sockets[0].destroyed).toBe(false);
    expect(connects).toHaveLength(1);
  });

  it('honours the timings it is given rather than its own', async () => {
    // Seam 1: leaving these hardcoded would have this package quietly owning a
    // tuning decision each app thinks it owns.
    const { pool, sockets } = makePool({ watchdogSeconds: 2, reconnectDelayMs: 100 });
    pool.establish('10.10.10.1', 11102);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1900);
    expect(sockets[0].destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(sockets[0].destroyed).toBe(true);
  });
});

describe('clients are told what is happening', () => {
  it('says reconnecting, then reconnected', async () => {
    const { pool, sockets } = makePool({ watchdogSeconds: 8, reconnectDelayMs: 5000 });
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    const ws = wsClient();
    entry.clients.add(sse);
    entry.wsClients.add(ws);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(8000);
    expect(sse.written.some((line) => line.startsWith('event: reconnecting'))).toBe(true);
    expect(JSON.parse(ws.sent[0]).status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(sse.written.some((line) => line.startsWith('event: reconnected'))).toBe(true);
    expect(JSON.parse(ws.sent[ws.sent.length - 1]).status).toBe('connected');
  });

  it('keeps attached clients across a reconnect rather than dropping them', async () => {
    const { pool, sockets } = makePool({ watchdogSeconds: 8, reconnectDelayMs: 5000 });
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    entry.clients.add(sse);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(13000);
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.entries.get('10.10.10.1:11102')?.clients.has(sse)).toBe(true);
    // And the new socket feeds the same client.
    sockets[1].fire('data', '$GPRMC,after*00\r\n');
    expect(sse.written).toContain('data: $GPRMC,after*00\n\n');
  });

  it('reports a socket error to WebSocket clients and records it on the entry', () => {
    const { pool, sockets } = makePool();
    const entry = pool.establish('10.10.10.1', 11102);
    const ws = wsClient();
    entry.wsClients.add(ws);

    sockets[0].fire('error', { message: 'ECONNREFUSED' });

    expect(entry.isSocketConnected).toBe(false);
    expect(entry.lastLoggedErrorMsg).toBe('ECONNREFUSED');
    expect(JSON.parse(ws.sent[0])).toMatchObject({ status: 'error', message: 'ECONNREFUSED' });
  });
});

describe('shouldKeepAlive', () => {
  it('blocks a close that the last client leaving would otherwise cause', () => {
    // HarborSentinel's product rule: a closed browser tab must not end a boat's
    // drag alarm. It is an option rather than a branch because it is not a
    // pooling rule.
    const { pool } = makePool({ shouldKeepAlive: () => true });
    pool.establish('10.10.10.1', 11102);

    pool.closeIfEmpty('10.10.10.1:11102');

    expect(pool.entries.has('10.10.10.1:11102')).toBe(true);
  });

  it('allows the close when nothing objects', () => {
    const { pool, sockets } = makePool({ shouldKeepAlive: () => false });
    pool.establish('10.10.10.1', 11102);

    pool.closeIfEmpty('10.10.10.1:11102');

    expect(pool.entries.has('10.10.10.1:11102')).toBe(false);
    expect(sockets[0].destroyed).toBe(true);
  });

  it('keeps the connection when the host cannot answer', () => {
    // Unavailable is not the same as "no watch running", and the safe direction
    // is to keep the feed a drag alarm may be depending on.
    const { pool } = makePool({
      shouldKeepAlive: () => {
        throw new Error('database gone');
      },
    });
    pool.establish('10.10.10.1', 11102);

    pool.closeIfEmpty('10.10.10.1:11102');

    expect(pool.entries.has('10.10.10.1:11102')).toBe(true);
  });

  it('refuses to close while a client is still attached, whatever it says', () => {
    const { pool } = makePool({ shouldKeepAlive: () => false });
    const entry = pool.establish('10.10.10.1', 11102);
    entry.clients.add(sseClient());

    pool.closeIfEmpty('10.10.10.1:11102');

    expect(pool.entries.has('10.10.10.1:11102')).toBe(true);
  });

  it('reconnects on an unexpected close while a watch is running', async () => {
    const { pool, connects } = makePool({ shouldKeepAlive: () => true, reconnectDelayMs: 100 });
    pool.establish('10.10.10.1', 11102);
    await vi.advanceTimersByTimeAsync(0);

    pool.entries.get('10.10.10.1:11102')!.socket.destroy();
    (pool.entries.get('10.10.10.1:11102')!.socket as ReturnType<typeof stubSocket>).fire('close');

    await vi.advanceTimersByTimeAsync(100);
    expect(connects).toHaveLength(2);
  });
});

describe('drop', () => {
  it('closes regardless of clients or shouldKeepAlive', () => {
    // Called when the configured gateway has CHANGED, so the socket being
    // protected points at an address the navigator has stopped using.
    const { pool, sockets } = makePool({ shouldKeepAlive: () => true });
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    const ws = wsClient();
    entry.clients.add(sse);
    entry.wsClients.add(ws);

    pool.drop('10.10.10.1:11102');

    expect(pool.entries.has('10.10.10.1:11102')).toBe(false);
    expect(sockets[0].destroyed).toBe(true);
    expect(sse.ended).toBe(true);
    expect(ws.closed).toBe(true);
  });

  it('does not schedule a reconnect for something deliberately dropped', async () => {
    const { pool, connects } = makePool({ shouldKeepAlive: () => true, reconnectDelayMs: 100 });
    pool.establish('10.10.10.1', 11102);
    await vi.advanceTimersByTimeAsync(0);

    pool.drop('10.10.10.1:11102');
    await vi.advanceTimersByTimeAsync(1000);

    expect(connects).toHaveLength(1);
  });
});

describe('the seams that are not the pool', () => {
  it('hands every sentence to onSentence, before broadcasting', () => {
    // Seam 2: HarborSentinel's live snapshot for the anchor watch.
    const seen: string[] = [];
    const { pool, sockets } = makePool({ onSentence: (sentence) => void seen.push(sentence) });
    pool.establish('10.10.10.1', 11102);

    sockets[0].fire('data', '$GPRMC,one*00\r\n$GPRMC,two*00\r\n');

    expect(seen).toEqual(['$GPRMC,one*00', '$GPRMC,two*00']);
  });

  it('survives an onSentence that throws', () => {
    // One bad sentence should cost that sentence, not the feed.
    const { pool, sockets } = makePool({
      onSentence: () => {
        throw new Error('parser blew up');
      },
    });
    const entry = pool.establish('10.10.10.1', 11102);
    const sse = sseClient();
    entry.clients.add(sse);

    expect(() => sockets[0].fire('data', '$GPRMC,one*00\r\n$GPRMC,two*00\r\n')).not.toThrow();
    expect(sse.written).toHaveLength(2);
  });

  it('normalises a host into the pool key', () => {
    const { pool } = makePool({ normalizeHost: (value) => value.toLowerCase() });
    pool.establish('BOAT.local', 11102);
    expect([...pool.entries.keys()]).toEqual(['boat.local:11102']);
  });

  it('sets TCP_NODELAY and keepalive, as OpenCPN does', () => {
    const { pool, sockets } = makePool();
    pool.establish('10.10.10.1', 11102);
    expect(sockets[0].noDelay).toBe(true);
    expect(sockets[0].keepAlive).toBe(true);
  });
});

describe('two pools in one process', () => {
  it('do not share state', () => {
    // Harbor's copy held the pool, its timers and the "current" host and port in
    // module scope, so two hosts in one process would have fought over them.
    const a = makePool();
    const b = makePool();

    a.pool.establish('10.10.10.1', 11102);

    expect(a.pool.entries.size).toBe(1);
    expect(b.pool.entries.size).toBe(0);
  });
});

/**
 * UDP, added 2026-09-27. A gateway that broadcasts has no client slot to
 * contend for, so any number of devices can listen to one feed.
 *
 * Everything downstream of the bytes is the TCP path, deliberately: the tests
 * below assert that it really is the same splitting, the same filter and the
 * same watchdog rather than a second implementation that resembles it.
 */
describe('a UDP listener', () => {
  it('binds the port instead of dialling, and keys itself apart from TCP', async () => {
    const { pool, udpSockets } = makeUdpPool();

    pool.establish(null, 11102, { transport: 'udp' });

    expect(udpSockets[0].bound).toBe(11102);
    expect([...pool.entries.keys()]).toEqual(['udp:11102']);
  });

  it('never collides with a TCP entry on the same port', () => {
    const tcpSockets: ReturnType<typeof stubSocket>[] = [];
    const pool = createNmeaPool({
      createConnection: () => {
        const socket = stubSocket();
        tcpSockets.push(socket);
        return socket;
      },
      createUdpSocket: () => stubUdpSocket(),
    });

    pool.establish('10.10.10.1', 11102);
    pool.establish('10.10.10.1', 11102, { transport: 'udp' });

    expect([...pool.entries.keys()]).toEqual(['10.10.10.1:11102', 'udp:10.10.10.1:11102']);
    expect(pool.entries.size).toBe(2);
  });

  it('shares one listener between clients, as TCP does', () => {
    const { pool, udpSockets } = makeUdpPool();

    const first = pool.establish('', 11102, { transport: 'udp' });
    const second = pool.establish('', 11102, { transport: 'udp' });

    expect(second).toBe(first);
    expect(udpSockets.length).toBe(1);
  });

  it('fans a datagram out through the same splitting and filter', () => {
    const seen: string[] = [];
    const { pool, udpSockets } = makeUdpPool({ onSentence: (s) => void seen.push(s) });
    const entry = pool.establish('', 11102, { transport: 'udp' });
    const sse = sseClient();
    const ws = wsClient();
    entry.clients.add(sse);
    entry.wsClients.add(ws);

    udpSockets[0].send('garbage\r\n$GPRMC,one*00\r\n!AIVDM,1*00\r\n');

    expect(sse.written).toEqual(['data: $GPRMC,one*00\n\n', 'data: !AIVDM,1*00\n\n']);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'nmea', sentence: '$GPRMC,one*00' });
    expect(seen).toEqual(['$GPRMC,one*00', '!AIVDM,1*00']);
  });

  it('treats the end of a datagram as the end of a sentence', () => {
    /*
      The TCP path holds an unterminated tail until the rest arrives, which is
      right for a stream and wrong for datagrams: there is no continuity between
      them, so a retained tail would be spliced onto whatever came next. Here
      each datagram stands alone and the buffer is empty between them.
    */
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('', 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);

    udpSockets[0].send('$GPRMC,one*00');
    udpSockets[0].send('$GPRMC,two*00');

    expect(sse.written).toEqual(['data: $GPRMC,one*00\n\n', 'data: $GPRMC,two*00\n\n']);
    expect(entry.buffer).toBe('');
  });

  it('accepts only the configured source when one was given', () => {
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('10.10.10.1', 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);

    udpSockets[0].send('$GPRMC,theirs*00\r\n', '10.10.10.99');
    expect(sse.written).toEqual([]);

    udpSockets[0].send('$GPRMC,ours*00\r\n', '10.10.10.1');
    expect(sse.written).toEqual(['data: $GPRMC,ours*00\n\n']);
  });

  it('matches a bracketed IPv6 source against the unbracketed one dgram reports', () => {
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('[fe80::1]', 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);

    udpSockets[0].send('$GPRMC,ours*00\r\n', 'fe80::1');

    expect(sse.written).toEqual(['data: $GPRMC,ours*00\n\n']);
  });

  it('accepts from anywhere when no source was configured', () => {
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish(null, 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);

    udpSockets[0].send('$GPRMC,one*00\r\n', '10.10.10.99');
    udpSockets[0].send('$GPRMC,two*00\r\n', '192.168.1.7');

    expect(sse.written.length).toBe(2);
  });

  it('trusts a datagram whose source the socket did not report', () => {
    // A filter is there to keep two gateways apart, not to be a security
    // boundary, so an unverifiable source is carried rather than silenced.
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('10.10.10.1', 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);

    udpSockets[0].send('$GPRMC,one*00\r\n');

    expect(sse.written).toEqual(['data: $GPRMC,one*00\n\n']);
  });

  it('reports reconnecting after the watchdog silence, then rebinds', async () => {
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('', 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);
    await vi.advanceTimersByTimeAsync(0); // let the bind callback land

    udpSockets[0].send('$GPRMC,one*00\r\n');
    sse.written.length = 0;

    await vi.advanceTimersByTimeAsync(8000); // watchdog
    expect(sse.written.join('')).toContain('event: reconnecting');
    expect(udpSockets[0].closed).toBe(true);

    await vi.advanceTimersByTimeAsync(5000); // reconnect delay
    expect(udpSockets.length).toBe(2);
    expect(udpSockets[1].bound).toBe(11102);

    await vi.advanceTimersByTimeAsync(0);
    expect(sse.written.join('')).toContain('event: reconnected');
    expect(pool.entries.get('udp:11102')?.isSocketConnected).toBe(true);
  });

  it('feeds the watchdog on a datagram, so a live feed is never rebound', async () => {
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('', 11102, { transport: 'udp' });
    entry.clients.add(sseClient());
    await vi.advanceTimersByTimeAsync(0);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      udpSockets[0].send('$GPRMC,alive*00\r\n');
    }

    expect(udpSockets.length).toBe(1);
    expect(udpSockets[0].closed).toBe(false);
  });

  it('keeps retrying a socket that errors before it ever binds', async () => {
    // EADDRINUSE: dgram reports it on the socket and then throws on close, so
    // no 'close' follows and the pool's whole recovery hangs off that event.
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('', 11102, { transport: 'udp' });
    entry.clients.add(sseClient());

    udpSockets[0].closeThrows = true;
    udpSockets[0].fail('bind EADDRINUSE 0.0.0.0:11102');

    await vi.advanceTimersByTimeAsync(5000);
    expect(udpSockets.length).toBe(2);
  });

  it('closes and forgets a listener nothing is attached to', () => {
    const { pool, udpSockets } = makeUdpPool();
    pool.establish('', 11102, { transport: 'udp' });

    pool.closeIfEmpty('udp:11102');

    expect(udpSockets[0].closed).toBe(true);
    expect(pool.entries.size).toBe(0);
  });

  it('drops a listener outright when the configuration changes', () => {
    const { pool, udpSockets } = makeUdpPool();
    const entry = pool.establish('', 11102, { transport: 'udp' });
    const sse = sseClient();
    entry.clients.add(sse);

    pool.drop('udp:11102');

    expect(sse.ended).toBe(true);
    expect(udpSockets[0].closed).toBe(true);
    expect(pool.entries.size).toBe(0);
  });

  it('refuses UDP outright when no socket factory was injected', () => {
    // Better than a pool that silently answers with an entry no data reaches.
    const { pool } = makePool();
    expect(() => pool.establish('', 11102, { transport: 'udp' })).toThrow(/createUdpSocket/);
    expect(pool.entries.size).toBe(0);
  });

  it('is still TCP when no transport is asked for', () => {
    const { pool, connects } = makePool();
    pool.establish('10.10.10.1', 11102);
    expect(connects).toEqual([{ host: '10.10.10.1', port: 11102 }]);
  });
});

/**
 * The settings dialogs' test button, which has no connection to test under UDP:
 * the only answer available is whether anything turns up.
 */
describe('listenForNmea', () => {
  it('counts the sentences heard in the window and samples the first', async () => {
    const socket = stubUdpSocket();
    const promise = listenForNmea({ createUdpSocket: () => socket, port: '11102', timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(0);

    socket.send('$GPRMC,one*00\r\n$GPRMC,two*00\r\n');
    socket.send('rubbish\r\n!AIVDM,three*00\r\n');

    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({ heard: 3, sample: '$GPRMC,one*00' });
    expect(socket.bound).toBe(11102);
    expect(socket.closed).toBe(true);
  });

  it('reports a silent gateway as zero rather than as a failure', async () => {
    const socket = stubUdpSocket();
    const promise = listenForNmea({ createUdpSocket: () => socket, port: 11102, timeoutMs: 2000 });

    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toEqual({ heard: 0 });
  });

  it('counts only the configured source', async () => {
    const socket = stubUdpSocket();
    const promise = listenForNmea({
      createUdpSocket: () => socket,
      port: 11102,
      host: '10.10.10.1',
      timeoutMs: 1000,
    });

    socket.send('$GPRMC,theirs*00\r\n', '10.10.10.99');
    socket.send('$GPRMC,ours*00\r\n', '10.10.10.1');

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ heard: 1, sample: '$GPRMC,ours*00' });
  });

  it('rejects on a socket error, because a held port is not a quiet gateway', async () => {
    const socket = stubUdpSocket();
    const promise = listenForNmea({ createUdpSocket: () => socket, port: 11102, timeoutMs: 1000 });

    socket.fail('bind EADDRINUSE 0.0.0.0:11102');

    await expect(promise).rejects.toThrow(/EADDRINUSE/);
    expect(socket.closed).toBe(true);
  });

  it('stops listening once the window closes', async () => {
    const socket = stubUdpSocket();
    const promise = listenForNmea({ createUdpSocket: () => socket, port: 11102, timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    socket.send('$GPRMC,late*00\r\n');

    expect(result.heard).toBe(0);
  });
});
