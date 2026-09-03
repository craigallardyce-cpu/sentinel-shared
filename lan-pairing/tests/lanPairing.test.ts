import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLanPairing, isLoopbackAddress } from '../src/index';

/**
 * These are the boat's front door.
 *
 * Every case here is something that was true of the fleet at some point: a
 * server answering the whole marina, a desktop unable to authenticate against
 * its own backend because of an IPv4-mapped loopback address, a token readable
 * by the devices it was meant to exclude.
 */

let dir: string;
let tokenFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-pairing-'));
  tokenFile = path.join(dir, 'nested', 'pairing-token.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** An Express-ish response that records what the guard did to it. */
function fakeRes() {
  const out: { code: number | null; body: any } = { code: null, body: null };
  const res = {
    status(code: number) {
      out.code = code;
      return res;
    },
    json(body: any) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

const from = (remoteAddress: string, url = '/status', headers: Record<string, any> = {}) => ({
  url,
  headers,
  socket: { remoteAddress },
});

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])('accepts %s', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(true);
  });

  it.each(['192.168.1.50', '10.8.0.4', '::ffff:192.168.1.50', '', null, undefined])(
    'rejects %s',
    (addr) => {
      expect(isLoopbackAddress(addr as any)).toBe(false);
    }
  );
});

describe('the pairing token', () => {
  it('is minted once and survives a restart', () => {
    const first = createLanPairing({ tokenFile }).getPairingToken();
    expect(first).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    // A second instance is a restart: same file, same token, so nothing re-pairs.
    expect(createLanPairing({ tokenFile }).getPairingToken()).toBe(first);
  });

  it('creates the directory it was pointed at', () => {
    createLanPairing({ tokenFile }).getPairingToken();
    expect(fs.existsSync(tokenFile)).toBe(true);
  });

  it('replaces a corrupt or too-short token file rather than failing to start', () => {
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, '{ not json', 'utf8');
    expect(createLanPairing({ tokenFile }).getPairingToken()).toHaveLength(19);

    fs.writeFileSync(tokenFile, JSON.stringify({ token: 'short' }), 'utf8');
    expect(createLanPairing({ tokenFile }).getPairingToken()).toHaveLength(19);
  });

  it('rotates when the file is deleted', () => {
    const before = createLanPairing({ tokenFile }).getPairingToken();
    fs.rmSync(tokenFile);
    expect(createLanPairing({ tokenFile }).getPairingToken()).not.toBe(before);
  });
});

describe('lanAuthGuard', () => {
  it('lets the machine itself through with no token', () => {
    const { lanAuthGuard } = createLanPairing({ tokenFile });
    const { res, out } = fakeRes();
    let passed = false;
    lanAuthGuard(from('127.0.0.1'), res, () => (passed = true));
    expect(passed).toBe(true);
    expect(out.code).toBeNull();
  });

  it('refuses the boat network without one', () => {
    const { lanAuthGuard } = createLanPairing({ tokenFile });
    const { res, out } = fakeRes();
    let passed = false;
    lanAuthGuard(from('192.168.1.77'), res, () => (passed = true));
    expect(passed).toBe(false);
    expect(out.code).toBe(401);
    // The hint has to describe what actually fixes it. It used to name a field.
    expect(out.body.hint).toContain('nothing to type');
  });

  it('accepts the token as a query parameter, for the callers that cannot set headers', () => {
    const pairing = createLanPairing({ tokenFile });
    const token = pairing.getPairingToken();
    const { res } = fakeRes();
    let passed = false;
    pairing.lanAuthGuard(from('192.168.1.77', `/nmea/stream?host=10.0.0.2&token=${token}`), res, () => (passed = true));
    expect(passed).toBe(true);
  });

  it('accepts the token as a header', () => {
    const pairing = createLanPairing({ tokenFile });
    const token = pairing.getPairingToken();
    const { res } = fakeRes();
    let passed = false;
    pairing.lanAuthGuard(from('192.168.1.77', '/status', { 'x-sentinel-token': token }), res, () => (passed = true));
    expect(passed).toBe(true);
  });

  it('refuses a wrong token, and one of a different length', () => {
    const pairing = createLanPairing({ tokenFile });
    const token = pairing.getPairingToken();
    for (const wrong of ['AAAA-BBBB-CCCC-DDDD', token.slice(0, -1), token + 'X', '']) {
      const { res, out } = fakeRes();
      let passed = false;
      pairing.lanAuthGuard(from('192.168.1.77', `/status?token=${wrong}`), res, () => (passed = true));
      expect(passed, wrong).toBe(false);
      expect(out.code, wrong).toBe(401);
    }
  });

  it('survives a malformed URL instead of throwing inside the middleware', () => {
    const pairing = createLanPairing({ tokenFile });
    const { res, out } = fakeRes();
    let passed = false;
    pairing.lanAuthGuard(from('192.168.1.77', '//%'), res, () => (passed = true));
    expect(passed).toBe(false);
    expect(out.code).toBe(401);
  });
});

describe('pairingTokenHandler', () => {
  it('gives the machine itself its own token', () => {
    const pairing = createLanPairing({ tokenFile });
    const { res, out } = fakeRes();
    pairing.pairingTokenHandler(from('::1'), res);
    expect(out.body.token).toBe(pairing.getPairingToken());
  });

  it('never serves it over the network, which is the point of having one', () => {
    const pairing = createLanPairing({ tokenFile });
    const { res, out } = fakeRes();
    pairing.pairingTokenHandler(from('192.168.1.77'), res);
    expect(out.code).toBe(403);
    expect(JSON.stringify(out.body)).not.toContain(pairing.getPairingToken());
  });
});
