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
