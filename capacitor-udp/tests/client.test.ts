import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({}),
  Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false },
}));

import { CapacitorUdpClient, listenForSentences, sourceMatches, splitDatagram } from '../src/client';
import type { SentinelUdpPlugin, UdpDatagramEvent, UdpErrorEvent } from '../src/definitions';

/** A stand-in for the native side: records binds and closes, and lets a test deliver datagrams. */
function fakePlugin({ failListen = false } = {}) {
  let nextId = 1;
  const open = new Set<number>();
  const listeners: { datagram: Set<(e: UdpDatagramEvent) => void>; error: Set<(e: UdpErrorEvent) => void> } = {
    datagram: new Set(),
    error: new Set(),
  };
  let listenGate: Promise<void> | null = null;
  const plugin = {
    listen: vi.fn(async ({ port }: { port: number }) => {
      if (listenGate) await listenGate;
      if (failListen) throw new Error(`Could not listen on UDP port ${port}: Address in use`);
      const id = nextId++;
      open.add(id);
      return { id };
    }),
    close: vi.fn(async ({ id }: { id: number }) => {
      open.delete(id);
    }),
    addListener: vi.fn(async (name: 'datagram' | 'error', fn: any) => {
      (listeners[name] as Set<any>).add(fn);
      return { remove: async () => void (listeners[name] as Set<any>).delete(fn) };
    }),
  };
  return {
    plugin: plugin as unknown as SentinelUdpPlugin,
    raw: plugin,
    open,
    listeners,
    send(id: number, data: string, address = '192.168.4.1') {
      for (const fn of [...listeners.datagram]) fn({ id, address, data });
    },
    error(id: number, message: string) {
      for (const fn of [...listeners.error]) fn({ id, message });
    },
    holdListen() {
      let release!: () => void;
      listenGate = new Promise((r) => (release = r));
      return () => {
        listenGate = null;
        release();
      };
    },
  };
}

describe('splitDatagram', () => {
  it('splits a datagram into its NMEA lines and drops anything else', () => {
    expect(splitDatagram('$GPRMC,1*00\r\n!AIVDM,1*11\nhello\n  $IIDBT,2*22  \r\n$PART')).toEqual([
      '$GPRMC,1*00',
      '!AIVDM,1*11',
      '$IIDBT,2*22',
      '$PART',
    ]);
  });

  it('returns nothing for an empty datagram', () => {
    expect(splitDatagram('')).toEqual([]);
  });
});

describe('sourceMatches', () => {
  it('passes every sender when no address was given', () => {
    expect(sourceMatches('', '10.0.0.9')).toBe(true);
    expect(sourceMatches(undefined, '10.0.0.9')).toBe(true);
  });

  it('passes only the configured sender, brackets and case aside', () => {
    expect(sourceMatches('192.168.4.1', '192.168.4.1')).toBe(true);
    expect(sourceMatches('192.168.4.1', '192.168.4.2')).toBe(false);
    expect(sourceMatches('[FE80::1]', 'fe80::1')).toBe(true);
  });
});

describe('CapacitorUdpClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('binds the port and delivers each NMEA line', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const lines: string[] = [];
    await client.connect('', '10110', (l) => lines.push(l));
    expect(fake.raw.listen).toHaveBeenCalledWith({ port: 10110 });
    fake.send(1, '$GPRMC,a*00\r\n$IIMWV,b*00\r\n');
    expect(lines).toEqual(['$GPRMC,a*00', '$IIMWV,b*00']);
    expect(client.isActive).toBe(true);
  });

  it('drops datagrams from other senders when an address is set', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const lines: string[] = [];
    await client.connect('192.168.4.1', 10110, (l) => lines.push(l));
    fake.send(1, '$OTHER*00', '192.168.4.77');
    fake.send(1, '$MINE*00', '192.168.4.1');
    expect(lines).toEqual(['$MINE*00']);
  });

  it('ignores datagrams for another listener', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const lines: string[] = [];
    await client.connect('', 10110, (l) => lines.push(l));
    fake.send(99, '$ELSEWHERE*00');
    expect(lines).toEqual([]);
  });

  it('rejects when the port cannot be bound, without calling onError', async () => {
    const fake = fakePlugin({ failListen: true });
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const onError = vi.fn();
    await expect(client.connect('', 10110, () => {}, onError)).rejects.toThrow(/Address in use/);
    expect(onError).not.toHaveBeenCalled();
    expect(client.isActive).toBe(false);
    expect(fake.listeners.datagram.size).toBe(0);
  });

  it('rejects a port that is not a number', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    await expect(client.connect('', 'abc', () => {})).rejects.toThrow(/Not a UDP port/);
    expect(fake.raw.listen).not.toHaveBeenCalled();
  });

  it('reports silence once through onError and closes the socket', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin, dataTimeoutMs: 1000 });
    const onError = vi.fn();
    await client.connect('', 10110, () => {}, onError);
    await vi.advanceTimersByTimeAsync(999);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toMatch(/Nothing heard on UDP port 10110/);
    expect(fake.open.size).toBe(0);
    expect(client.isActive).toBe(false);
  });

  it('keeps listening while sentences keep arriving', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin, dataTimeoutMs: 1000 });
    const onError = vi.fn();
    await client.connect('', 10110, () => {}, onError);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(800);
      fake.send(1, '$GPRMC*00');
    }
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not count a sender it filters out as data', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin, dataTimeoutMs: 1000 });
    const onError = vi.fn();
    await client.connect('192.168.4.1', 10110, () => {}, onError);
    await vi.advanceTimersByTimeAsync(800);
    fake.send(1, '$OTHER*00', '10.0.0.5');
    await vi.advanceTimersByTimeAsync(300);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports a native error once', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const onError = vi.fn();
    await client.connect('', 10110, () => {}, onError);
    fake.error(1, 'Socket closed by the system');
    fake.error(1, 'again');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('delivers nothing after disconnect, and never reports it', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin, dataTimeoutMs: 1000 });
    const onData = vi.fn();
    const onError = vi.fn();
    await client.connect('', 10110, onData, onError);
    await client.disconnect();
    fake.send(1, '$LATE*00');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fake.open.size).toBe(0);
    expect(fake.listeners.datagram.size).toBe(0);
  });

  it('closes the previous listener when connecting again', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const first = vi.fn();
    const second = vi.fn();
    await client.connect('', 10110, first);
    await client.connect('', 10110, second);
    expect(fake.open).toEqual(new Set([2]));
    fake.send(1, '$OLD*00');
    fake.send(2, '$NEW*00');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('$NEW*00');
  });

  it('closes a socket whose bind finished after disconnect', async () => {
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    const release = fake.holdListen();
    const attempt = client.connect('', 10110, () => {});
    await vi.advanceTimersByTimeAsync(0);
    await client.disconnect();
    release();
    await attempt;
    expect(fake.open.size).toBe(0);
    expect(client.isActive).toBe(false);
  });

  it('sends nothing, because UDP input is receive-only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakePlugin();
    const client = new CapacitorUdpClient({ plugin: fake.plugin });
    await client.send('$AUTOPILOT*00');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('listenForSentences', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts what arrives in the time given, then closes', async () => {
    const fake = fakePlugin();
    const result = listenForSentences({ host: '', port: 10110, durationMs: 5000, plugin: fake.plugin });
    await vi.advanceTimersByTimeAsync(10);
    fake.send(1, '$A*00\r\n$B*00\r\n');
    fake.send(1, 'noise');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe(2);
    expect(fake.open.size).toBe(0);
  });

  it('rejects when the port cannot be bound', async () => {
    const fake = fakePlugin({ failListen: true });
    await expect(listenForSentences({ port: 10110, plugin: fake.plugin })).rejects.toThrow(/Address in use/);
  });
});
