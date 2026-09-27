import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NMEA_TARGET,
  nmeaPoolKey,
  resolveNmeaTarget,
  splitPoolKey,
  stalePoolKeys,
} from '../src/nmeaTarget.js';

/**
 * These had no tests. The function decides which gateway every NMEA client in
 * the fleet attaches to, and its precedence rule exists because both apps got it
 * wrong in the same way — consulting an open socket before the stored
 * configuration, which is why changing the address appeared to do nothing until
 * the process restarted.
 */

describe('precedence', () => {
  it('lets an explicit request beat everything', () => {
    expect(
      resolveNmeaTarget({
        requested: { host: '10.0.0.9', port: '2000' },
        configured: { host: '10.10.10.1', port: '11102' },
        activeKeys: ['192.168.1.5:10110'],
      })
    ).toEqual({ host: '10.0.0.9', port: '2000', source: 'requested' });
  });

  it('ignores a half request, because a host with no port is not an address', () => {
    expect(
      resolveNmeaTarget({ requested: { host: '10.0.0.9' }, configured: { host: '10.10.10.1', port: '11102' } })
    ).toEqual({ host: '10.10.10.1', port: '11102', source: 'config' });
  });

  it('puts the configured address ahead of an open socket', () => {
    // The bug this rule exists for: the save landed, the next client found a
    // socket already open to the old gateway and joined it, and nothing short of
    // a restart cleared it.
    expect(
      resolveNmeaTarget({ configured: { host: '10.10.10.1', port: '11102' }, activeKeys: ['192.168.1.5:10110'] })
    ).toEqual({ host: '10.10.10.1', port: '11102', source: 'config' });
  });

  it('falls back to a pooled socket only when nothing is configured', () => {
    expect(resolveNmeaTarget({ activeKeys: ['192.168.1.5:10110'] })).toEqual({
      host: '192.168.1.5',
      port: '10110',
      source: 'pool',
    });
  });

  it('falls back to the declared gateway when nothing answers at all', () => {
    expect(resolveNmeaTarget()).toEqual({ ...DEFAULT_NMEA_TARGET, source: 'fallback' });
  });

  it('takes the fallback port when a configured host carries none', () => {
    expect(resolveNmeaTarget({ configured: { host: 'boat.local' } })).toEqual({
      host: 'boat.local',
      port: DEFAULT_NMEA_TARGET.port,
      source: 'config',
    });
  });

  it('treats blank and whitespace as absent rather than as an address', () => {
    expect(resolveNmeaTarget({ configured: { host: '   ', port: '' } }).source).toBe('fallback');
  });
});

describe('the phone and the PC', () => {
  /*
    The case the whole layered design exists for. Both are correct at once, and
    resolveNmeaTarget sees only an address because @sentinel/settings has already
    decided which layer won.
  */
  it('resolves each to its own gateway from the same function', () => {
    const phone = resolveNmeaTarget({ configured: { host: '127.0.0.1', port: 10110 } });
    const pc = resolveNmeaTarget({ configured: { host: '10.10.10.1', port: 11102 } });

    expect(phone).toEqual({ host: '127.0.0.1', port: '10110', source: 'config' });
    expect(pc).toEqual({ host: '10.10.10.1', port: '11102', source: 'config' });
  });

  it('accepts a numeric port, as a settings store returns it', () => {
    expect(resolveNmeaTarget({ configured: { host: 'boat.local', port: 11102 } }).port).toBe('11102');
  });
});

describe('splitPoolKey', () => {
  it('splits on the rightmost colon so an IPv6 literal survives', () => {
    expect(splitPoolKey('10.10.10.1:11102')).toEqual({ host: '10.10.10.1', port: '11102' });
    expect(splitPoolKey('[fe80::1]:10110')).toEqual({ host: '[fe80::1]', port: '10110' });
  });

  it('refuses a key that is not host:port', () => {
    for (const key of ['10.10.10.1', ':11102', '10.10.10.1:', '']) {
      expect(splitPoolKey(key), key).toBeNull();
    }
  });
});

describe('stalePoolKeys', () => {
  it('names every connection that is no longer the target', () => {
    // Saving a new address has to reach the socket, not just the row: the old
    // one keeps delivering, so the chart shows data from a device the navigator
    // has stopped pointing at.
    expect(
      stalePoolKeys(['10.10.10.1:11102', '192.168.1.5:10110'], { host: '10.10.10.1', port: '11102' })
    ).toEqual(['192.168.1.5:10110']);
  });

  it('names none when the pool already matches', () => {
    expect(stalePoolKeys(['10.10.10.1:11102'], { host: '10.10.10.1', port: '11102' })).toEqual([]);
  });
});

/**
 * The transport, added 2026-09-27 alongside UDP.
 *
 * The bar for every test here is that TCP resolves to exactly what it resolved
 * to before — including the shape of the object, since `protocol` is left off
 * entirely rather than set to `'tcp'`. The tests above are the proof of that
 * and were not touched.
 */
describe('protocol', () => {
  it('says nothing about transport for a TCP target', () => {
    const target = resolveNmeaTarget({ configured: { host: '10.10.10.1', port: '11102' } });
    expect(target.protocol).toBeUndefined();
    expect(target).toEqual({ host: '10.10.10.1', port: '11102', source: 'config' });
  });

  it('carries a configured UDP transport through', () => {
    expect(resolveNmeaTarget({ configured: { host: '10.10.10.1', port: '11102', protocol: 'udp' } })).toEqual({
      host: '10.10.10.1',
      port: '11102',
      protocol: 'udp',
      source: 'config',
    });
  });

  it('accepts a configured UDP listener with no host, because there is nothing to dial', () => {
    expect(resolveNmeaTarget({ configured: { port: '11102', protocol: 'udp' } })).toEqual({
      host: '',
      port: '11102',
      protocol: 'udp',
      source: 'config',
    });
  });

  it('still ignores a configured TCP port with no host', () => {
    // Unchanged: a port alone is not somewhere to connect to.
    expect(resolveNmeaTarget({ configured: { port: '11102' } }).source).toBe('fallback');
  });

  it('lets a UDP request win on a port alone', () => {
    expect(
      resolveNmeaTarget({
        requested: { port: '2000', protocol: 'udp' },
        configured: { host: '10.10.10.1', port: '11102' },
      })
    ).toEqual({ host: '', port: '2000', protocol: 'udp', source: 'requested' });
  });

  it('reads anything that is not udp as tcp', () => {
    for (const protocol of ['TCP', 'websocket', '', null, undefined]) {
      expect(resolveNmeaTarget({ configured: { host: 'boat.local', port: '11102', protocol } }).protocol).toBeUndefined();
    }
  });

  it('recovers the transport from a pooled UDP key', () => {
    expect(resolveNmeaTarget({ activeKeys: ['udp:11102'] })).toEqual({
      host: '',
      port: '11102',
      protocol: 'udp',
      source: 'pool',
    });
  });
});

describe('nmeaPoolKey', () => {
  it('keeps the TCP key exactly as it was', () => {
    expect(nmeaPoolKey({ host: '10.10.10.1', port: 11102 })).toBe('10.10.10.1:11102');
    expect(nmeaPoolKey({ host: '10.10.10.1', port: '11102', protocol: 'tcp' })).toBe('10.10.10.1:11102');
  });

  it('separates a UDP listener from a TCP connection on the same port', () => {
    expect(nmeaPoolKey({ port: 11102, protocol: 'udp' })).toBe('udp:11102');
    expect(nmeaPoolKey({ host: '10.10.10.1', port: 11102, protocol: 'udp' })).toBe('udp:10.10.10.1:11102');
    expect(nmeaPoolKey({ host: '10.10.10.1', port: 11102, protocol: 'udp' })).not.toBe(
      nmeaPoolKey({ host: '10.10.10.1', port: 11102 })
    );
  });

  it('round-trips through splitPoolKey', () => {
    for (const target of [
      { host: '10.10.10.1', port: '11102' },
      { host: '[fe80::1]', port: '10110' },
      { host: '', port: '11102', protocol: 'udp' as const },
      { host: '10.10.10.1', port: '11102', protocol: 'udp' as const },
      { host: '[fe80::1]', port: '10110', protocol: 'udp' as const },
    ]) {
      const split = splitPoolKey(nmeaPoolKey(target));
      expect(split, nmeaPoolKey(target)).not.toBeNull();
      expect(split!.host).toBe(target.host);
      expect(split!.port).toBe(target.port);
      expect(split!.protocol ?? 'tcp').toBe(target.protocol ?? 'tcp');
    }
  });

  it('rejects a UDP key that is neither a port nor a host and port', () => {
    expect(splitPoolKey('udp:')).toBeNull();
    expect(splitPoolKey('udp:not-a-port')).toBeNull();
    expect(splitPoolKey('udp::11102')).toBeNull();
  });
});

describe('stalePoolKeys with a transport', () => {
  it('keeps the UDP listener that matches and closes the rest', () => {
    expect(
      stalePoolKeys(['udp:11102', 'udp:10.10.10.1:11102', '10.10.10.1:11102'], {
        host: '',
        port: '11102',
        protocol: 'udp',
      })
    ).toEqual(['udp:10.10.10.1:11102', '10.10.10.1:11102']);
  });

  it('treats a TCP connection to a port as stale once that port is being listened to', () => {
    // Switching transport has to close the old socket, or the boat is fed by
    // both and the one the navigator just stopped using keeps winning.
    expect(stalePoolKeys(['10.10.10.1:11102'], { host: '10.10.10.1', port: '11102', protocol: 'udp' })).toEqual([
      '10.10.10.1:11102',
    ]);
  });
});
