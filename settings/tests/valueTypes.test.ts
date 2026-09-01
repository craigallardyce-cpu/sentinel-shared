import { describe, expect, it } from 'vitest';
import {
  boolType,
  hostType,
  hostTypeWith,
  intType,
  listType,
  mmsiType,
  numberType,
  oneOf,
  portType,
  stringType,
  urlType,
} from '../src/valueTypes.js';

describe('the shared contract', () => {
  it('turns anything unusable into undefined rather than throwing', () => {
    const garbage = [undefined, null, {}, [], () => 0, Symbol('x'), NaN];
    for (const value of garbage) {
      expect(() => intType().parse(value)).not.toThrow();
      expect(intType().parse(value)).toBeUndefined();
    }
  });

  it('round-trips every type through serialize and back', () => {
    expect(stringType().parse(stringType().serialize('Saorsaa'))).toBe('Saorsaa');
    expect(boolType.parse(boolType.serialize(true))).toBe(true);
    expect(boolType.parse(boolType.serialize(false))).toBe(false);
    expect(intType().parse(intType().serialize(5))).toBe(5);
    expect(numberType().parse(numberType().serialize(5.5))).toBe(5.5);
    expect(hostType.parse(hostType.serialize('10.10.10.1'))).toBe('10.10.10.1');
    expect(portType.parse(portType.serialize(11102))).toBe(11102);
    expect(mmsiType.parse(mmsiType.serialize('367123456'))).toBe('367123456');
  });
});

describe('bool', () => {
  it('reads the three spellings the fleet has written', () => {
    // 'true' in localStorage, 1 in HarborSentinel's SQLite, a real boolean from Supabase.
    expect(boolType.parse('true')).toBe(true);
    expect(boolType.parse(1)).toBe(true);
    expect(boolType.parse(true)).toBe(true);
    expect(boolType.parse('false')).toBe(false);
    expect(boolType.parse(0)).toBe(false);
  });

  it('does not invent a value for a word it does not know', () => {
    expect(boolType.parse('maybe')).toBeUndefined();
  });
});

describe('numbers', () => {
  it('falls through rather than clamping an out-of-range stored value', () => {
    const limit = numberType({ min: 0.008, max: 5 });
    expect(limit.parse(0)).toBeUndefined();
    expect(limit.parse(50)).toBeUndefined();
    expect(limit.parse(0.5)).toBe(0.5);
  });

  it('rejects a non-integer for an int', () => {
    expect(intType().parse(5.5)).toBeUndefined();
    expect(numberType().parse(5.5)).toBe(5.5);
  });

  it('rejects the NaN that parseInt hands out today', () => {
    // parseInt('not a number', 10) is NaN, and every current read site passes it on.
    expect(intType().parse('not a number')).toBeUndefined();
  });
});

describe('host', () => {
  it('accepts hostnames and IPv4', () => {
    expect(hostType.parse('10.10.10.1')).toBe('10.10.10.1');
    expect(hostType.parse('remote.rdsensing.com')).toBe('remote.rdsensing.com');
    expect(hostType.parse('  127.0.0.1  ')).toBe('127.0.0.1');
  });

  it('refuses a scheme or a port, because normalising those belongs at the input', () => {
    expect(hostType.parse('tcp://10.10.10.1')).toBeUndefined();
    expect(hostType.parse('http://10.10.10.1')).toBeUndefined();
    expect(hostType.parse('10.10.10.1:11102')).toBeUndefined();
    expect(hostType.parse('10.10.10.1/api')).toBeUndefined();
  });

  it('requires IPv6 to be bracketed, so splitPoolKey can still split on the last colon', () => {
    expect(hostType.parse('[fe80::1]')).toBe('[fe80::1]');
    expect(hostType.parse('fe80::1')).toBeUndefined();
  });
});

describe('port', () => {
  it('holds the range', () => {
    expect(portType.parse(11102)).toBe(11102);
    expect(portType.parse('10110')).toBe(10110);
    expect(portType.parse(0)).toBeUndefined();
    expect(portType.parse(65536)).toBeUndefined();
    expect(portType.parse(80.5)).toBeUndefined();
  });
});

describe('mmsi', () => {
  it('takes nine digits or nothing at all', () => {
    expect(mmsiType.parse('367123456')).toBe('367123456');
    expect(mmsiType.parse('')).toBe('');
    expect(mmsiType.parse('   ')).toBe('');
  });

  it('rejects a half-typed number rather than storing it', () => {
    // A wrong MMSI silently stops own ship being suppressed from AIS alarms,
    // so falling back to "not known" is the safe direction.
    expect(mmsiType.parse('3671234')).toBeUndefined();
    expect(mmsiType.parse('36712345678')).toBeUndefined();
    expect(mmsiType.parse('36712345x')).toBeUndefined();
  });
});

describe('url', () => {
  it('requires an absolute http(s) URL', () => {
    expect(urlType().parse('http://10.10.10.1:11102')).toBe('http://10.10.10.1:11102');
    expect(urlType().parse('10.10.10.1')).toBeUndefined();
    expect(urlType().parse('ws://10.10.10.1')).toBeUndefined();
  });

  it('strips trailing slashes, which both apps do by hand today', () => {
    expect(urlType().parse('http://boat.local/')).toBe('http://boat.local');
  });

  it('treats empty as a value only when asked, since that is how both apps say "standalone"', () => {
    expect(urlType().parse('')).toBeUndefined();
    expect(urlType({ allowEmpty: true }).parse('')).toBe('');
  });
});

describe('oneOf', () => {
  it('admits only the declared values', () => {
    const source = oneOf(['NMEA LOCAL', 'DEVICE GPS'] as const);
    expect(source.parse('NMEA LOCAL')).toBe('NMEA LOCAL');
    expect(source.parse('NMEA REMOTE')).toBeUndefined();
  });
});

describe('list', () => {
  it('parses from JSON and from a real array', () => {
    const fields = listType(stringType());
    expect(fields.parse('["position","wind"]')).toEqual(['position', 'wind']);
    expect(fields.parse(['position', 'wind'])).toEqual(['position', 'wind']);
  });

  it('invalidates the whole list when one element is bad', () => {
    // A partially-parsed list is a log entry that silently records fewer
    // fields than the navigator chose.
    expect(listType(intType()).parse('[1, 2, "three"]')).toBeUndefined();
    expect(listType(stringType()).parse('not json')).toBeUndefined();
  });
});

describe('host, allowEmpty', () => {
  it('treats empty as "no address configured" only when asked', () => {
    expect(hostType.parse('')).toBeUndefined();
    expect(hostTypeWith({ allowEmpty: true }).parse('')).toBe('');
    expect(hostTypeWith({ allowEmpty: true }).parse('relay.example.com')).toBe('relay.example.com');
    expect(hostTypeWith({ allowEmpty: true }).parse('tcp://relay.example.com')).toBeUndefined();
  });
});
