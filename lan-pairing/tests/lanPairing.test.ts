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

  it('writes the token file whole, by rename, leaving no temporary behind', () => {
    const token = createLanPairing({ tokenFile }).getPairingToken();
    const stored = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    expect(stored.token).toBe(token);
    expect(typeof stored.createdAt).toBe('string');
    expect(fs.readdirSync(path.dirname(tokenFile))).toEqual(['pairing-token.json']);
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
    // The desktop loads http://localhost:<port>, so that is the Host it sends.
    lanAuthGuard(from('127.0.0.1', '/status', { host: 'localhost:3000' }), res, () => (passed = true));
    expect(passed).toBe(true);
    expect(out.code).toBeNull();
  });

  it.each(['localhost:5001', 'LOCALHOST', '127.0.0.1:3000', '127.0.0.1', '[::1]:5001', '[::1]'])(
    'lets loopback through with Host %s',
    (host) => {
      const { lanAuthGuard } = createLanPairing({ tokenFile });
      const { res } = fakeRes();
      let passed = false;
      lanAuthGuard(from('::ffff:127.0.0.1', '/status', { host }), res, () => (passed = true));
      expect(passed).toBe(true);
    }
  );

  it.each(['evil.example', 'evil.example:3000', 'localhost.evil.example', '192.168.1.5:3000', '[::1]x', 'localhost:abc', undefined])(
    'treats loopback with Host %s as the boat network (DNS rebinding)',
    (host) => {
      const { lanAuthGuard } = createLanPairing({ tokenFile });
      const { res, out } = fakeRes();
      let passed = false;
      lanAuthGuard(from('127.0.0.1', '/status', host === undefined ? {} : { host }), res, () => (passed = true));
      expect(passed).toBe(false);
      expect(out.code).toBe(401);
    }
  );

  it('still accepts a valid token on loopback with a foreign Host', () => {
    // Falls through to the token check rather than being refused outright.
    const pairing = createLanPairing({ tokenFile });
    const token = pairing.getPairingToken();
    const { res } = fakeRes();
    let passed = false;
    pairing.lanAuthGuard(from('127.0.0.1', '/status', { host: 'evil.example', 'x-sentinel-token': token }), res, () => (passed = true));
    expect(passed).toBe(true);
  });

  it('accepts the boat network with a valid token whatever its Host says', () => {
    const pairing = createLanPairing({ tokenFile });
    const token = pairing.getPairingToken();
    for (const host of ['192.168.1.10:3000', 'boat.local', 'localhost', undefined]) {
      const { res } = fakeRes();
      let passed = false;
      const headers = host === undefined ? { 'x-sentinel-token': token } : { host, 'x-sentinel-token': token };
      pairing.lanAuthGuard(from('192.168.1.77', '/status', headers), res, () => (passed = true));
      expect(passed, String(host)).toBe(true);
    }
  });

  it('checks a WebSocket upgrade, a bare IncomingMessage, by the same rule', () => {
    const pairing = createLanPairing({ tokenFile });
    expect(pairing.isAuthorizedRequest(from('127.0.0.1', '/ws', { host: 'localhost:3000' }))).toBe(true);
    expect(pairing.isAuthorizedRequest(from('127.0.0.1', '/ws', { host: 'evil.example' }))).toBe(false);
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
    pairing.pairingTokenHandler(from('::1', '/api/pairing-token', { host: 'localhost:5001' }), res);
    expect(out.body.token).toBe(pairing.getPairingToken());
  });

  it('refuses loopback with a foreign Host, which is a rebound web page', () => {
    const pairing = createLanPairing({ tokenFile });
    const token = pairing.getPairingToken();
    for (const headers of [{ host: 'evil.example' }, {}]) {
      const { res, out } = fakeRes();
      pairing.pairingTokenHandler(from('127.0.0.1', '/api/pairing-token', headers), res);
      expect(out.code).toBe(403);
      expect(JSON.stringify(out.body)).not.toContain(token);
    }
  });

  it('never serves it over the network, which is the point of having one', () => {
    const pairing = createLanPairing({ tokenFile });
    const { res, out } = fakeRes();
    pairing.pairingTokenHandler(from('192.168.1.77'), res);
    expect(out.code).toBe(403);
    expect(JSON.stringify(out.body)).not.toContain(pairing.getPairingToken());
  });
});
