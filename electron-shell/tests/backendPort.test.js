import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { createRequire } from 'node:module';
import * as shell from '../src/index.js';
import {
  trackBackendListen,
  getBackendListenState,
  onBackendListenState,
  retryBackendListen,
  backendWindowContent,
  backendPageUrl,
  portInUseMessage,
  createBackendWindowGuard,
  BACKEND_ID_PATH,
  isBackendIdProbe,
  _resetBackendListenRegistry
} from '../src/backendPort.js';

// Every server here binds an ephemeral port (listen on 0) on loopback, never the
// apps' 3000 / 3001 / 5001, and every one is closed in afterEach.
const HOST = '127.0.0.1';
const opened = [];

function listenBlocker() {
  return new Promise((resolve) => {
    const blocker = net.createServer();
    opened.push(blocker);
    blocker.listen(0, HOST, () => resolve(blocker.address().port));
  });
}

function closeAll() {
  return Promise.all(opened.splice(0).map((s) => new Promise((r) => (s.listening ? s.close(() => r()) : r()))));
}

function nextState(port, wanted) {
  return new Promise((resolve) => {
    const off = onBackendListenState(port, (view) => {
      if (view.state === wanted) {
        queueMicrotask(() => off());
        resolve(view);
      }
    });
  });
}

function decode(url) {
  expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
  return decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
}

beforeEach(() => {
  _resetBackendListenRegistry();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeAll();
});

describe('index exports', () => {
  it('re-exports the backend-port API from the package root', () => {
    for (const name of ['trackBackendListen', 'getBackendListenState', 'onBackendListenState',
      'retryBackendListen', 'backendWindowContent', 'backendPageUrl', 'portInUseMessage',
      'createBackendWindowGuard']) {
      expect(typeof shell[name]).toBe('function');
    }
  });

  it('keeps the registry on a global symbol, so two copies of the package agree', () => {
    const require = createRequire(import.meta.url);
    const path = require.resolve('../src/backendPort.js');
    const first = require(path);
    delete require.cache[path];
    const second = require(path);
    expect(second).not.toBe(first);
    first.getBackendListenState(5850);
    expect(globalThis[Symbol.for('@sentinel/electron-shell/backend-listen')].has(5850)).toBe(true);
    expect(second.getBackendListenState(5850).state).toBe('waiting');
  });
});

describe('backendWindowContent', () => {
  it('shows the app only once our server is listening', () => {
    expect(backendWindowContent('listening')).toBe('app');
    expect(backendWindowContent('waiting')).toBe('starting');
    expect(backendWindowContent(undefined)).toBe('starting');
    expect(backendWindowContent('port-in-use')).toBe('port-in-use');
    expect(backendWindowContent('failed')).toBe('failed');
  });
});

describe('trackBackendListen with real servers', () => {
  it('records listening when our server binds the port', async () => {
    const port = await listenBlocker();
    await closeAll(); // free it, then bind it ourselves
    const server = http.createServer();
    opened.push(server);
    const listening = nextState(port, 'listening');
    server.listen(port, HOST);
    trackBackendListen(server, { port, host: HOST });
    expect(getBackendListenState(port).state).toBe('waiting');
    await listening;
    expect(getBackendListenState(port)).toEqual({ port, state: 'listening', code: null });
  });

  it('records port-in-use on EADDRINUSE instead of throwing', async () => {
    const port = await listenBlocker();
    const server = http.createServer();
    opened.push(server);
    const inUse = nextState(port, 'port-in-use');
    server.listen(port, HOST);
    trackBackendListen(server, { port, host: HOST });
    const view = await inUse;
    expect(view).toEqual({ port, state: 'port-in-use', code: 'EADDRINUSE' });
    expect(server.listening).toBe(false);
  });

  it('retries on the same port and runs the original listen callback when it succeeds', async () => {
    const blockerPort = await listenBlocker();
    const onListening = vi.fn();
    const server = http.createServer();
    opened.push(server);
    const inUse = nextState(blockerPort, 'port-in-use');
    server.listen(blockerPort, HOST, onListening);
    trackBackendListen(server, { port: blockerPort, host: HOST });
    await inUse;

    // Still taken: the retry reports in-use again, and nothing else happens.
    // (Subscribe after the retry: onBackendListenState reports the current state at once.)
    expect(retryBackendListen(blockerPort)).toBe(true);
    expect(getBackendListenState(blockerPort).state).toBe('waiting');
    const inUseAgain = nextState(blockerPort, 'port-in-use');
    await inUseAgain;
    expect(onListening).not.toHaveBeenCalled();

    // The other program goes away; Try again now binds the SAME port.
    await new Promise((r) => opened[0].close(() => r()));
    expect(retryBackendListen(blockerPort)).toBe(true);
    await nextState(blockerPort, 'listening');
    expect(server.address().port).toBe(blockerPort);
    expect(onListening).toHaveBeenCalledOnce();
  });

  it('does not retry while waiting or listening, or with no server tracked', async () => {
    expect(retryBackendListen(5851)).toBe(false);
    const port = await listenBlocker();
    await closeAll();
    const server = http.createServer();
    opened.push(server);
    const listening = nextState(port, 'listening');
    server.listen(port, HOST);
    trackBackendListen(server, { port, host: HOST });
    expect(retryBackendListen(port)).toBe(false); // waiting
    await listening;
    expect(retryBackendListen(port)).toBe(false); // listening
  });

  it('classifies EACCES as port-in-use and other errors as failed', () => {
    const fake = { on: vi.fn(), listening: false };
    trackBackendListen(fake, { port: 5852 });
    const onError = fake.on.mock.calls.find(([event]) => event === 'error')[1];
    onError(Object.assign(new Error('denied'), { code: 'EACCES' }));
    expect(getBackendListenState(5852)).toEqual({ port: 5852, state: 'port-in-use', code: 'EACCES' });
    onError(Object.assign(new Error('odd'), { code: 'EINVAL' }));
    expect(getBackendListenState(5852)).toEqual({ port: 5852, state: 'failed', code: 'EINVAL' });
  });

  it('ignores errors on a server that is already listening', () => {
    const fake = { on: vi.fn(), listening: true };
    trackBackendListen(fake, { port: 5853 });
    expect(getBackendListenState(5853).state).toBe('listening');
    const onError = fake.on.mock.calls.find(([event]) => event === 'error')[1];
    onError(Object.assign(new Error('late'), { code: 'EADDRINUSE' }));
    expect(getBackendListenState(5853).state).toBe('listening');
  });

  it('rejects a missing server or port 0', () => {
    expect(() => trackBackendListen(null, { port: 5854 })).toThrow(TypeError);
    expect(() => trackBackendListen({ on() {} }, { port: 0 })).toThrow(TypeError);
  });
});

describe('backendPageUrl', () => {
  it('builds a self-contained port-in-use page with Try again', () => {
    const html = decode(backendPageUrl('port-in-use', { appName: 'HarborSentinel', port: 3000 }));
    expect(html).toContain("HarborSentinel couldn&#39;t start");
    expect(html).toContain('port 3000');
    expect(html).toContain('Close that program, then press Try again.');
    expect(html).toContain('id="retry"');
    expect(html).toContain('window.appBackend.retry()');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('keeps the wording free of jargon', () => {
    const text = portInUseMessage({ appName: 'OceanSentinel', port: 5001 }).join(' ');
    expect(text).toContain('OceanSentinel');
    expect(text).toContain('5001');
    expect(text).not.toMatch(/EADDRINUSE|localhost|backend|server|socket|bind/i);
  });

  it('escapes the app name', () => {
    const html = decode(backendPageUrl('starting', { appName: '<b>X</b>', port: 1 }));
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });

  it('builds a starting page with no button and a failed page with one', () => {
    expect(decode(backendPageUrl('starting', { appName: 'A', port: 1 }))).not.toContain('id="retry"');
    expect(decode(backendPageUrl('failed', { appName: 'A', port: 1 }))).toContain('id="retry"');
  });
});

function fakeWindow() {
  return { loadURL: vi.fn(() => Promise.resolve()), isDestroyed: vi.fn(() => false) };
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    on: vi.fn((channel, fn) => handlers.set(channel, fn)),
    removeAllListeners: vi.fn((channel) => handlers.delete(channel)),
    emit: (channel) => handlers.get(channel)?.({})
  };
}

// Drives the registry directly: a fake server whose listen() is recorded and whose
// 'listening' / 'error' handlers the test fires.
function trackedFakeServer(port) {
  const handlers = {};
  const server = {
    listening: false,
    on: (event, fn) => { handlers[event] = fn; },
    listen: vi.fn()
  };
  trackBackendListen(server, { port, host: '0.0.0.0' });
  return {
    server,
    listen() { server.listening = true; handlers.listening(); },
    inUse() { handlers.error(Object.assign(new Error('in use'), { code: 'EADDRINUSE' })); }
  };
}

describe('createBackendWindowGuard', () => {
  const PORT = 5860;
  let win;
  let ipcMain;
  let loadApp;
  let guard;

  beforeEach(() => {
    win = fakeWindow();
    ipcMain = fakeIpcMain();
    loadApp = vi.fn(() => Promise.resolve());
    guard = createBackendWindowGuard({
      appName: 'HarborSentinel', port: PORT, ipcMain, getMainWindow: () => win, loadApp
    });
  });

  afterEach(() => guard.dispose());

  it('loads nothing before show()', () => {
    const fake = trackedFakeServer(PORT);
    fake.listen();
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(loadApp).not.toHaveBeenCalled();
  });

  it('shows Starting, then the app once our server listens', () => {
    const fake = trackedFakeServer(PORT);
    guard.show();
    expect(guard.content()).toBe('starting');
    expect(decode(win.loadURL.mock.calls[0][0])).toContain('Starting HarborSentinel');
    expect(loadApp).not.toHaveBeenCalled();
    fake.listen();
    expect(guard.content()).toBe('app');
    expect(loadApp).toHaveBeenCalledWith(win);
  });

  it('goes straight to the app when the server was already listening', () => {
    trackedFakeServer(PORT).listen();
    guard.show();
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(loadApp).toHaveBeenCalledOnce();
  });

  it('never loads the app URL while the port belongs to someone else', () => {
    const fake = trackedFakeServer(PORT);
    guard.show();
    fake.inUse();
    expect(guard.content()).toBe('port-in-use');
    expect(loadApp).not.toHaveBeenCalled();
    expect(decode(win.loadURL.mock.calls.at(-1)[0])).toContain('Try again');
  });

  it('Try again re-listens on the same port and host, then loads the app', () => {
    const fake = trackedFakeServer(PORT);
    guard.show();
    fake.inUse();
    ipcMain.emit('backend:retry');
    expect(fake.server.listen).toHaveBeenCalledWith(PORT, '0.0.0.0');
    expect(guard.content()).toBe('starting');
    fake.listen();
    expect(guard.content()).toBe('app');
    expect(loadApp).toHaveBeenCalledOnce();
  });

  it('loads the app at most once per window, and again for a new window', () => {
    const fake = trackedFakeServer(PORT);
    guard.show();
    fake.listen();
    fake.listen();
    expect(loadApp).toHaveBeenCalledOnce();
    win = fakeWindow();
    expect(guard.content()).toBe('none');
    guard.show();
    expect(loadApp).toHaveBeenCalledTimes(2);
    expect(loadApp).toHaveBeenLastCalledWith(win);
  });

  it('does nothing when there is no window or it is destroyed', () => {
    const fake = trackedFakeServer(PORT);
    guard.show();
    win.isDestroyed.mockReturnValue(true);
    fake.listen();
    expect(loadApp).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The ownership check: 'listening' is reported only once what answers at
// http://localhost:<port> is this very process's server. Real servers on
// ephemeral ports throughout; FAST keeps the bounded retries quick.

const FAST = { attempts: 3, intervalMs: 20, timeoutMs: 300 };

function bind(server, port, host) {
  opened.push(server);
  return new Promise((resolve) => {
    const onError = (err) => resolve(err.code || 'error');
    server.once('error', onError);
    const done = () => { server.off('error', onError); resolve(null); };
    if (host === undefined) server.listen(port, done);
    else server.listen(port, host, done);
  });
}

function foreignHttp() {
  return http.createServer((req, res) => res.end('SOME OTHER PROGRAM'));
}

// A port nobody holds right now.
async function freePort() {
  const port = await listenBlocker();
  const blocker = opened.pop();
  await new Promise((r) => blocker.close(() => r()));
  return port;
}

function get(host, port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: host, port, path, method, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// A foreign program bound to `foreignHost` on an ephemeral P, then ours on
// `ourHost` (a wildcard) on the same P, tracked. Skips, saying why, when this OS
// refuses ours the port -- then the loopback hole cannot occur here at all.
async function coBind(foreign, foreignHost, ourHost, ctx) {
  const blocked = await bind(foreign, 0, foreignHost);
  if (blocked) ctx.skip(`cannot bind ${foreignHost} on this machine (${blocked})`);
  const port = foreign.address().port;
  const ours = http.createServer((req, res) => res.end('OUR APP'));
  opened.push(ours);
  const verdict = new Promise((resolve) => {
    const off = onBackendListenState(port, (view) => {
      if (view.state === 'port-in-use' || view.state === 'listening' || view.state === 'failed') {
        queueMicrotask(() => off());
        resolve(view);
      }
    });
  });
  if (ourHost === undefined) ours.listen(port);
  else ours.listen(port, ourHost);
  trackBackendListen(ours, { port, host: ourHost, verify: FAST });
  const view = await verdict;
  if (view.code === 'EADDRINUSE' || view.code === 'EACCES') {
    ctx.skip(
      `this OS refuses ${ourHost || 'the default host'}:${port} while another program holds ` +
      `${foreignHost}:${port} (${view.code}), so the loopback hole cannot occur here`
    );
  }
  return { port, ours };
}

describe('the ownership check with real servers', () => {
  it('reports listening, via verifying, when our server alone holds the port on 0.0.0.0', async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => res.end('OUR APP'));
    const seen = [];
    const off = onBackendListenState(port, (view) => seen.push(view.state));
    const listening = nextState(port, 'listening');
    await bind(server, port, '0.0.0.0');
    trackBackendListen(server, { port, host: '0.0.0.0', verify: FAST });
    await listening;
    off();
    expect(seen).toContain('verifying');
    expect(getBackendListenState(port)).toEqual({ port, state: 'listening', code: null });
  });

  it('reports listening on the default host (::, as OceanSentinel binds)', async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => res.end('OUR APP'));
    const listening = nextState(port, 'listening');
    await bind(server, port, undefined);
    trackBackendListen(server, { port, verify: FAST });
    await listening;
    expect(getBackendListenState(port).state).toBe('listening');
  });

  it('gives port-in-use when another program on 127.0.0.1:P answers, though ours bound 0.0.0.0:P', async (ctx) => {
    const { port, ours } = await coBind(foreignHttp(), '127.0.0.1', '0.0.0.0', ctx);
    expect(getBackendListenState(port)).toEqual({ port, state: 'port-in-use', code: 'ELOCALHOSTFOREIGN' });
    expect(ours.listening).toBe(true); // LAN clients keep working; only the window is withheld
    expect(console.error.mock.calls.flat().join(' ')).toMatch(/another program answers on localhost/);
  });

  it('gives port-in-use when another program on [::1]:P answers, though ours bound 0.0.0.0:P', async (ctx) => {
    const { port } = await coBind(foreignHttp(), '::1', '0.0.0.0', ctx);
    expect(getBackendListenState(port)).toEqual({ port, state: 'port-in-use', code: 'ELOCALHOSTFOREIGN' });
  });

  it('gives port-in-use when another program on 127.0.0.1:P answers, though ours bound the default host', async (ctx) => {
    const { port } = await coBind(foreignHttp(), '127.0.0.1', undefined, ctx);
    expect(getBackendListenState(port)).toEqual({ port, state: 'port-in-use', code: 'ELOCALHOSTFOREIGN' });
  });

  it('treats a non-HTTP reply on localhost as another program', async (ctx) => {
    // Reads what it is sent (so its sockets can close), and replies in something else.
    const garbage = net.createServer((s) => {
      s.resume();
      s.end('SSH-2.0-not-http\r\n\r\n');
    });
    const { port } = await coBind(garbage, '127.0.0.1', '0.0.0.0', ctx);
    expect(getBackendListenState(port)).toEqual({ port, state: 'port-in-use', code: 'ELOCALHOSTFOREIGN' });
  });

  it('keeps the window on the port-in-use page, and Try again re-checks without listen()', async (ctx) => {
    const foreign = foreignHttp();
    const { port, ours } = await coBind(foreign, '127.0.0.1', '0.0.0.0', ctx);
    const win = fakeWindow();
    const ipcMain = fakeIpcMain();
    const loadApp = vi.fn(() => Promise.resolve());
    const guard = createBackendWindowGuard({ appName: 'HarborSentinel', port, ipcMain, getMainWindow: () => win, loadApp });
    try {
      guard.show();
      expect(guard.content()).toBe('port-in-use');
      expect(loadApp).not.toHaveBeenCalled();

      // Still there: Try again checks again and lands on port-in-use again.
      const listenSpy = vi.spyOn(ours, 'listen');
      ipcMain.emit('backend:retry');
      expect(getBackendListenState(port).state).toBe('verifying');
      expect(guard.content()).toBe('starting');
      await nextState(port, 'port-in-use');
      expect(guard.content()).toBe('port-in-use');
      expect(loadApp).not.toHaveBeenCalled();

      // The other program goes away; Try again now loads our app.
      await new Promise((r) => foreign.close(() => r()));
      ipcMain.emit('backend:retry');
      await nextState(port, 'listening');
      expect(guard.content()).toBe('app');
      expect(loadApp).toHaveBeenCalledOnce();
      expect(listenSpy).not.toHaveBeenCalled();
    } finally {
      guard.dispose();
    }
  });

  it('fails after bounded retries when localhost never answers, and Try again recovers', async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => res.end('OUR APP'));
    await bind(server, port, '127.0.0.1');
    // Swallow the probe ahead of our route: the connection hangs, as it would
    // with a program that accepts and never replies.
    let hang = true;
    const untracked = server.emit;
    trackBackendListen(server, { port, host: '127.0.0.1', verify: FAST });
    const withRoute = server.emit;
    expect(withRoute).not.toBe(untracked);
    server.emit = function (event, ...args) {
      if (hang && event === 'request' && args[0].url === BACKEND_ID_PATH) return true;
      return withRoute.call(this, event, ...args);
    };
    const failed = await nextState(port, 'failed');
    expect(failed.code).toBe('ELOCALHOSTUNVERIFIED');
    expect(console.error.mock.calls.flat().join(' ')).toMatch(/after 3 attempts/);

    hang = false;
    expect(retryBackendListen(port)).toBe(true);
    await nextState(port, 'listening');
  });

  it('skips the check with verify: false, and for a server that is not an http.Server', async () => {
    const port = await freePort();
    const plain = net.createServer();
    await bind(plain, port, '127.0.0.1');
    trackBackendListen(plain, { port, host: '127.0.0.1' });
    expect(getBackendListenState(port).state).toBe('listening');

    const port2 = await freePort();
    const server = http.createServer();
    await bind(server, port2, '127.0.0.1');
    const emit = server.emit;
    trackBackendListen(server, { port: port2, host: '127.0.0.1', verify: false });
    expect(getBackendListenState(port2).state).toBe('listening');
    expect(server.emit).toBe(emit);
  });
});

describe('the ownership route', () => {
  it('answers only itself, ahead of the app, and leaves every other request to the app', async () => {
    const port = await freePort();
    const server = http.createServer();
    // Express-style handlers, one attached before tracking and one after: each
    // must see every request except the probe, and never the probe. The first
    // answers; a second response would throw ERR_HTTP_HEADERS_SENT.
    const seen = [];
    const express = (tag) => (req, res) => {
      seen.push(`${tag} ${req.method} ${req.url}`);
      if (tag !== 'before') return;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`app ${req.url}`);
    };
    server.on('request', express('before'));
    const listening = nextState(port, 'listening');
    await bind(server, port, '127.0.0.1');
    trackBackendListen(server, { port, host: '127.0.0.1', verify: FAST });
    server.on('request', express('after'));
    await listening;
    const errors = [];
    server.on('clientError', (err) => errors.push(err));
    expect(seen).toEqual([]); // the verification probe itself never reached the app

    const id = await get('127.0.0.1', port, BACKEND_ID_PATH);
    expect(id.status).toBe(200);
    expect(id.body).toMatch(/^[0-9a-f]{48}$/);
    const again = await get('127.0.0.1', port, `${BACKEND_ID_PATH}?x=1`);
    expect(again.body).toBe(id.body); // one token per process

    expect(await get('127.0.0.1', port, '/api/health')).toEqual({ status: 200, body: 'app /api/health' });
    expect(await get('127.0.0.1', port, BACKEND_ID_PATH, 'POST')).toEqual({ status: 200, body: `app ${BACKEND_ID_PATH}` });
    expect(await get('127.0.0.1', port, `${BACKEND_ID_PATH}x`)).toEqual({ status: 200, body: `app ${BACKEND_ID_PATH}x` });

    expect(seen).toEqual([
      'before GET /api/health', 'after GET /api/health',
      `before POST ${BACKEND_ID_PATH}`, `after POST ${BACKEND_ID_PATH}`,
      `before GET ${BACKEND_ID_PATH}x`, `after GET ${BACKEND_ID_PATH}x`
    ]);
    expect(errors).toEqual([]);
  });

  it('never let the verification probe reach the app', async () => {
    const port = await freePort();
    const server = http.createServer();
    const app = vi.fn((req, res) => res.end('app'));
    server.on('request', app);
    const listening = nextState(port, 'listening');
    await bind(server, port, '0.0.0.0');
    trackBackendListen(server, { port, host: '0.0.0.0', verify: FAST });
    await listening;
    expect(app).not.toHaveBeenCalled();
  });

  it('passes the path to the app when the request comes from off this machine', () => {
    const server = http.createServer();
    const app = vi.fn();
    server.on('request', app);
    trackBackendListen(server, { port: 5870, verify: FAST });
    const res = { writeHead: vi.fn(), end: vi.fn() };
    const lan = { method: 'GET', url: BACKEND_ID_PATH, socket: { remoteAddress: '192.168.1.20' } };
    server.emit('request', lan, res);
    expect(app).toHaveBeenCalledWith(lan, res);
    expect(res.end).not.toHaveBeenCalled();

    const local = { method: 'GET', url: BACKEND_ID_PATH, socket: { remoteAddress: '::ffff:127.0.0.1' } };
    server.emit('request', local, res);
    expect(app).toHaveBeenCalledOnce();
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('recognises loopback GETs of the reserved path only', () => {
    const req = (remoteAddress, method = 'GET', url = BACKEND_ID_PATH) => ({ method, url, socket: { remoteAddress } });
    expect(isBackendIdProbe(req('127.0.0.1'))).toBe(true);
    expect(isBackendIdProbe(req('::1'))).toBe(true);
    expect(isBackendIdProbe(req('::ffff:127.0.0.1'))).toBe(true);
    expect(isBackendIdProbe(req('10.0.0.5'))).toBe(false);
    expect(isBackendIdProbe(req('127.0.0.1', 'HEAD'))).toBe(false);
    expect(isBackendIdProbe(req('127.0.0.1', 'GET', '/'))).toBe(false);
    expect(BACKEND_ID_PATH).toBe('/__sentinel/backend-id');
  });

  it('installs the route once however often the server is tracked', () => {
    const server = http.createServer();
    trackBackendListen(server, { port: 5871, verify: FAST });
    const first = server.emit;
    trackBackendListen(server, { port: 5871, verify: FAST });
    expect(server.emit).toBe(first);
  });
});
