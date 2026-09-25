/**
 * Busy-port handling for a backend that runs IN-PROCESS with Electron's main
 * process (HarborSentinel on 3000, OceanSentinel on 5001: main.cjs require()s
 * dist/server.cjs and then loads the window from http://localhost:<port>).
 *
 * The rule, established by VesselKeeper for its forked backend (VesselKeeper #40):
 *
 *   - The window is pointed at http://localhost:<port> only once OUR server has
 *     emitted 'listening'. If it has not, whatever answers on that port is some
 *     other program, and loading it would show that program under our name.
 *   - When the port is taken, say so to the user and offer "Try again". Nothing
 *     retries on its own.
 *   - There is no fallback port. The port is part of the page's origin, which
 *     holds the sign-in session and saved settings; moving would orphan them.
 *
 * How the two halves meet. The server and main.cjs share one Node process, so the
 * listen outcome is kept in a registry on `globalThis` under a `Symbol.for` key,
 * keyed by port. The server calls trackBackendListen(server, { port }) right
 * after its listen() call; main.cjs subscribes with onBackendListenState(port)
 * or, more simply, createBackendWindowGuard(). A global rather than module state
 * so that the two sides agree even if the server bundle and main.cjs ever resolve
 * two copies of this package (the registry is the contract, not the module
 * instance), and a registry rather than exporting the http.Server from the
 * bundle because HarborSentinel creates its server late, inside an async
 * startServer(), long after main.cjs's require() has returned.
 *
 * Proving it is OUR server that answers (the ownership check). 'listening' on
 * our socket is not enough on its own. On Windows, and on other systems in some
 * configurations, a program bound only to loopback (127.0.0.1:<port> or
 * [::1]:<port>) does not stop our server binding the wildcard (0.0.0.0 or ::) on
 * the same port. Both then listen, the more specific loopback binding wins the
 * window's connection to http://localhost:<port>, and the window would show that
 * other program under our name. So after 'listening' the port is only reported
 * as 'listening' (and the app loaded) once a probe of localhost comes back with
 * this process's own token:
 *
 *   - trackBackendListen() makes the tracked http.Server answer one reserved
 *     path, GET /__sentinel/backend-id, with a random per-process token. It does
 *     so by wrapping server.emit for 'request', so that request is answered
 *     BEFORE any 'request' listener (Express) sees it and is never passed on:
 *     exactly one handler answers every request, and every other request reaches
 *     the app's handlers exactly as before. Only a request from a loopback
 *     address is answered this way; from the LAN the path falls through to the
 *     app like any unknown path, so the token is never offered off this machine.
 *   - It then probes GET http://<address>:<port>/__sentinel/backend-id at EVERY
 *     address the window's "localhost" can reach: 127.0.0.1 and ::1 (Chromium
 *     resolves localhost to loopback itself, both families, without asking the
 *     OS) plus whatever dns.lookup('localhost') returns. Chromium may connect to
 *     any of those that accepts, so all of them must be ours: an address that
 *     answers with anything other than our token -- another body, a non-HTTP
 *     reply -- gives 'port-in-use' (code 'ELOCALHOSTFOREIGN'); an address that
 *     refuses the connection is fine (Chromium falls back past it, too). A
 *     timeout or a dropped connection is retried a few times, a few hundred ms
 *     apart, and then gives 'failed' (code 'ELOCALHOSTUNVERIFIED'), as does no
 *     address reaching us at all.
 *   - On 'port-in-use' from the probe our server stays listening (LAN clients,
 *     such as a paired phone, keep working); only the window is withheld. "Try
 *     again" then re-runs the probe rather than listen(), which would throw on a
 *     server that is already listening.
 *
 * The probe needs an http.Server, which is what both apps pass. Anything else (a
 * plain net.Server, a test fake) cannot answer the token, so it is reported
 * 'listening' unverified, as before this check existed.
 *
 * Nothing in this file requires 'electron', so the server may import it when it
 * runs standalone under plain Node too. The probe runs there as well; it costs
 * one request to itself, and logs a line if something else answers on localhost.
 */

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const crypto = require('node:crypto');

const REGISTRY_KEY = Symbol.for('@sentinel/electron-shell/backend-listen');
const TOKEN_KEY = Symbol.for('@sentinel/electron-shell/backend-id-token');
const ROUTE_KEY = Symbol.for('@sentinel/electron-shell/backend-id-route');

/** The reserved path our tracked server answers with this process's token. */
const BACKEND_ID_PATH = '/__sentinel/backend-id';

/** Probe timing: bounded, so a wedged port reaches 'failed' within a few seconds. */
const DEFAULT_VERIFY = { attempts: 4, intervalMs: 250, timeoutMs: 1000 };

/** The loopback addresses Chromium's "localhost" can connect to. */
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'];

/**
 * Listen states, per port:
 *   'waiting'     -- nothing has reported yet, or a retry is in flight.
 *   'verifying'   -- our server is listening; the localhost probe is in flight.
 *   'listening'   -- our server holds the port AND is what answers at
 *                    http://localhost:<port>; the app URL is ours to load.
 *   'port-in-use' -- another program holds the port (EADDRINUSE), or the OS
 *                    refuses it to us (EACCES: on Windows, a port inside a range
 *                    reserved by Hyper-V/WSL fails this way rather than as in-use),
 *                    or another program answers on localhost although our server
 *                    is listening (ELOCALHOSTFOREIGN).
 *   'failed'      -- listen failed for some other reason, or the localhost probe
 *                    could not reach us (ELOCALHOSTUNVERIFIED).
 */

function registry() {
  if (!globalThis[REGISTRY_KEY]) globalThis[REGISTRY_KEY] = new Map();
  return globalThis[REGISTRY_KEY];
}

function entryFor(port) {
  const key = Number(port);
  const map = registry();
  let entry = map.get(key);
  if (!entry) {
    entry = {
      port: key, state: 'waiting', code: null, server: null, host: undefined,
      verify: null, generation: 0, listeners: new Set()
    };
    map.set(key, entry);
  }
  return entry;
}

function snapshot(entry) {
  return { port: entry.port, state: entry.state, code: entry.code };
}

function setState(entry, state, code = null) {
  entry.state = state;
  entry.code = code;
  const view = snapshot(entry);
  for (const listener of [...entry.listeners]) {
    try {
      listener(view);
    } catch (err) {
      console.error('[Backend] Listen-state listener threw:', err);
    }
  }
}

/** Classify a listen error into a listen state. Pure. */
function listenErrorState(err) {
  const code = err && err.code;
  if (code === 'EADDRINUSE' || code === 'EACCES') return 'port-in-use';
  return 'failed';
}

/**
 * SERVER SIDE. Call immediately after `server.listen(...)` / `app.listen(...)`,
 * in the same tick, so the handlers are attached before the outcome is emitted.
 * Records 'listening' or 'port-in-use' / 'failed' for `port`, and keeps the
 * server and host so retryBackendListen() can call listen() again on the SAME
 * port. It attaches an 'error' listener, so a busy port no longer surfaces as an
 * uncaught exception in Electron's main process; the server must not also exit
 * the process on EADDRINUSE when running in-process.
 *
 * For an http.Server it also installs the ownership route and, on 'listening',
 * probes localhost before reporting 'listening' (see the header). No other
 * route changes.
 *
 * @param {import('net').Server} server
 * @param {object} opts
 * @param {number} opts.port  The port passed to listen(). Must not be 0.
 * @param {string} [opts.host] The host passed to listen(), if any ('0.0.0.0').
 * @param {false | { attempts?: number, intervalMs?: number, timeoutMs?: number }} [opts.verify]
 *   Probe timing, or false to skip the ownership check. Apps leave it out.
 */
function trackBackendListen(server, { port, host, verify } = {}) {
  if (!server || typeof server.on !== 'function') {
    throw new TypeError('trackBackendListen: a net/http Server is required');
  }
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) {
    throw new TypeError('trackBackendListen: a fixed, non-zero port is required');
  }
  const entry = entryFor(port);
  entry.server = server;
  entry.host = host;
  entry.verify = verify === false || !canVerify(server) ? null : { ...DEFAULT_VERIFY, ...(verify || {}) };
  if (entry.verify) installBackendIdRoute(server);

  if (server.listening) {
    onListening(entry);
  } else if (entry.state !== 'waiting') {
    entry.generation += 1;
    setState(entry, 'waiting');
  }

  server.on('listening', () => {
    onListening(entry);
  });
  server.on('error', (err) => {
    // Runtime errors on an already-listening server are not a listen outcome.
    if (server.listening) {
      console.error(`[Backend] Server error on port ${entry.port}:`, err);
      return;
    }
    const state = listenErrorState(err);
    if (state === 'port-in-use') {
      console.error(
        `[Backend] Port ${entry.port} is already in use by another program (${err.code}). ` +
        'Not serving, and not loading that port in the window.'
      );
    } else {
      console.error(`[Backend] Could not listen on port ${entry.port}:`, err);
    }
    entry.generation += 1;
    setState(entry, state, (err && err.code) || null);
  });
}

// ---------------------------------------------------------------------------
// The ownership check (see the header).

/** This process's token, shared by every copy of the package via the global. */
function backendIdToken() {
  if (!globalThis[TOKEN_KEY]) globalThis[TOKEN_KEY] = crypto.randomBytes(24).toString('hex');
  return globalThis[TOKEN_KEY];
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  return address === '::1' || /^(::ffff:)?127\./i.test(address);
}

/** Whether `req` is the ownership probe, which we answer ourselves. Pure. */
function isBackendIdProbe(req) {
  if (!req || req.method !== 'GET' || typeof req.url !== 'string') return false;
  if (req.url.split('?')[0] !== BACKEND_ID_PATH) return false;
  return isLoopbackAddress(req.socket && req.socket.remoteAddress);
}

function canVerify(server) {
  return server instanceof http.Server || server instanceof https.Server;
}

/**
 * Answer BACKEND_ID_PATH on `server` ahead of its 'request' listeners. Wrapping
 * emit, rather than prepending a listener, means the probe is never also handed
 * to Express (no second response, no "headers already sent"), and listeners
 * added at any time still see every other request, unchanged and in order.
 * Idempotent per server.
 */
function installBackendIdRoute(server) {
  if (server[ROUTE_KEY]) return;
  const originalEmit = server.emit;
  server.emit = function emitWithBackendId(event, ...args) {
    if (event === 'request' && isBackendIdProbe(args[0])) {
      const res = args[1];
      const body = backendIdToken();
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
      });
      res.end(body);
      return true;
    }
    return originalEmit.call(this, event, ...args);
  };
  server[ROUTE_KEY] = true;
}

/** Every address the window's "localhost" might connect to, deduplicated. */
function localhostAddresses() {
  return new Promise((resolve) => {
    dns.lookup('localhost', { all: true }, (err, found) => {
      const extra = err || !Array.isArray(found) ? [] : found.map((a) => a.address);
      resolve([...new Set([...LOOPBACK_ADDRESSES, ...extra])]);
    });
  });
}

// Connection errors meaning "nobody listens at this address". That is fine:
// Chromium moves on to the next address, and so does the verdict.
const ABSENT_CODES = new Set(['ECONNREFUSED', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT']);

/**
 * GET the reserved path at one address, with the Host header the window sends.
 * Resolves to { address, outcome: 'ours'|'foreign'|'absent'|'error', detail }.
 */
function probeAddress(address, port, token, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let req;
    let socket = null;
    const done = (outcome, detail) => {
      if (settled) return;
      settled = true;
      // Never leave a socket open on whatever answered, whether it replied or
      // not. After a parse error the request no longer owns its socket, so
      // destroying the request alone would leave the connection half-open.
      if (req) req.destroy();
      if (socket) socket.destroy();
      resolve({ address, outcome, detail });
    };
    try {
      req = http.get({
        hostname: address,
        port,
        path: BACKEND_ID_PATH,
        agent: false,
        timeout: timeoutMs,
        headers: { Host: `localhost:${port}`, Connection: 'close' }
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size <= 4096) chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').trim();
          if (res.statusCode === 200 && body === token) done('ours');
          else done('foreign', `HTTP ${res.statusCode}`);
        });
        res.on('error', (err) => done('error', err.code || err.message));
      });
    } catch (err) {
      done('error', err.code || err.message);
      return;
    }
    req.on('socket', (s) => {
      socket = s;
    });
    req.on('timeout', () => done('error', 'timeout'));
    req.on('error', (err) => {
      const code = err && err.code;
      if (ABSENT_CODES.has(code)) done('absent', code);
      // Something answered, but not in HTTP: not our server.
      else if (typeof code === 'string' && code.startsWith('HPE_')) done('foreign', code);
      else done('error', code || (err && err.message));
    });
  });
}

/** One round over every localhost address: verdict 'ours'|'foreign'|'error'. */
async function probeLocalhostOnce(port, timeoutMs) {
  const token = backendIdToken();
  const addresses = await localhostAddresses();
  const results = await Promise.all(addresses.map((a) => probeAddress(a, port, token, timeoutMs)));
  const foreign = results.find((r) => r.outcome === 'foreign');
  if (foreign) return { verdict: 'foreign', at: foreign.address, results };
  if (results.some((r) => r.outcome === 'error')) return { verdict: 'error', results };
  if (results.some((r) => r.outcome === 'ours')) return { verdict: 'ours', results };
  return { verdict: 'error', results }; // nothing answers at localhost at all
}

function describeProbe(results) {
  return results.map((r) => `${r.address} ${r.outcome}${r.detail ? ` (${r.detail})` : ''}`).join(', ');
}

/**
 * Probe until there is a verdict, then set the state. Anything that changes the
 * state meanwhile (a listen error, a retry, another 'listening') bumps
 * entry.generation, which makes this run give up quietly.
 */
async function verifyOwnership(entry) {
  const generation = ++entry.generation;
  const { attempts, intervalMs, timeoutMs } = entry.verify;
  setState(entry, 'verifying');
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, intervalMs));
    if (generation !== entry.generation) return;
    last = await probeLocalhostOnce(entry.port, timeoutMs);
    if (generation !== entry.generation) return;
    if (last.verdict === 'ours') {
      setState(entry, 'listening');
      return;
    }
    if (last.verdict === 'foreign') {
      console.error(
        `[Backend] Our server is listening on port ${entry.port}, but another program answers on ` +
        `localhost:${entry.port} (at ${last.at}). Not loading that port in the window. [${describeProbe(last.results)}]`
      );
      setState(entry, 'port-in-use', 'ELOCALHOSTFOREIGN');
      return;
    }
  }
  console.error(
    `[Backend] Our server is listening on port ${entry.port}, but could not confirm that it is what ` +
    `answers on localhost:${entry.port} after ${attempts} attempts. [${describeProbe(last.results)}]`
  );
  setState(entry, 'failed', 'ELOCALHOSTUNVERIFIED');
}

function onListening(entry) {
  if (!entry.verify) {
    entry.generation += 1;
    setState(entry, 'listening');
    return;
  }
  verifyOwnership(entry).catch((err) => {
    console.error(`[Backend] The localhost check on port ${entry.port} threw:`, err);
    setState(entry, 'failed', 'ELOCALHOSTUNVERIFIED');
  });
}

/**
 * MAIN SIDE. The current listen state for `port`.
 * @returns {{ port: number, state: 'waiting'|'verifying'|'listening'|'port-in-use'|'failed', code: string|null }}
 */
function getBackendListenState(port) {
  return snapshot(entryFor(port));
}

/**
 * MAIN SIDE. Calls `listener` now with the current state, and again on every
 * change. Returns an unsubscribe function.
 */
function onBackendListenState(port, listener) {
  const entry = entryFor(port);
  entry.listeners.add(listener);
  listener(snapshot(entry));
  return () => entry.listeners.delete(listener);
}

/**
 * MAIN SIDE. One more attempt, after 'port-in-use' or 'failed'. If our server
 * never bound the port, listen() again on the same port: the server's original
 * listen() callback is still registered (Node adds it as a once('listening')
 * handler), so the app's startup work runs when a retry succeeds. If our server
 * IS listening and it was the localhost check that failed, re-run the check
 * instead (listen() would throw on a server that is already listening).
 * Returns true if an attempt was started.
 */
function retryBackendListen(port) {
  const entry = entryFor(port);
  if (!entry.server) return false;
  if (entry.state !== 'port-in-use' && entry.state !== 'failed') return false;
  if (entry.server.listening && entry.verify) {
    console.log(`[Backend] Checking localhost:${entry.port} again at the user's request.`);
    onListening(entry);
    return true;
  }
  console.log(`[Backend] Trying port ${entry.port} again at the user's request.`);
  entry.generation += 1;
  setState(entry, 'waiting');
  try {
    if (entry.host) entry.server.listen(entry.port, entry.host);
    else entry.server.listen(entry.port);
  } catch (err) {
    // listen() normally reports asynchronously via 'error'; a synchronous throw
    // (e.g. ERR_SERVER_ALREADY_LISTEN) is recorded the same way.
    console.error(`[Backend] Retry on port ${entry.port} threw:`, err);
    setState(entry, listenErrorState(err), (err && err.code) || null);
  }
  return true;
}

/**
 * What the window should show for a listen state. Pure. Only 'app' touches the
 * network, and only once our own server is listening and answers on localhost.
 * @returns {'starting'|'app'|'port-in-use'|'failed'}
 */
function backendWindowContent(state) {
  if (state === 'listening') return 'app';
  if (state === 'port-in-use') return 'port-in-use';
  if (state === 'failed') return 'failed';
  return 'starting';
}

// ---------------------------------------------------------------------------
// Local pages. Self-contained: inline style and script only, and a CSP that
// forbids loading anything, so they cannot reach the network. Colours are
// @sentinel/theme's day tokens (--bg-app, --text-primary, ...), spelt out as in
// TITLE_BAR_PALETTES because the main process cannot read a stylesheet.

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; background: #081425; color: #d8e3fb;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-app-region: drag; }
  main { max-width: 30rem; margin: 1.5rem; padding: 2rem; border-radius: 1rem; background: #111c2d;
         border: 1px solid #45464c; text-align: center; -webkit-app-region: no-drag; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { line-height: 1.5; margin: 0 0 1rem; color: #c6c6cd; }
  p:last-of-type { margin-bottom: 1.5rem; }
  button { font: inherit; font-weight: 600; padding: 0.6rem 1.5rem; border: 0; border-radius: 0.75rem;
           background: #4cd7f6; color: #081425; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

function toDataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// "Try again" asks main.cjs (via the preload's window.appBackend.retry, on the
// 'backend:retry' channel -- the same names VesselKeeper uses) for one attempt.
const RETRY_SCRIPT =
  "var b=document.getElementById('retry');" +
  "b.addEventListener('click',function(){" +
  "if(!window.appBackend||!window.appBackend.retry)return;" +
  "b.disabled=true;b.textContent='Trying…';window.appBackend.retry();});";

/** What the user reads when the port is taken. Plain words, for boat owners. */
function portInUseMessage({ appName, port }) {
  return [
    `Another program on this computer is using the connection ${appName} needs (port ${port}), so ${appName} can't open.`,
    `Close that program, then press Try again. If you don't know which program it is, restarting the computer usually frees it.`
  ];
}

function startingPageHtml({ appName }) {
  return page(appName, `<p style="margin:0">Starting ${escapeHtml(appName)}…</p>`);
}

function portInUsePageHtml({ appName, port }) {
  const body =
    `<h1>${escapeHtml(appName)} couldn't start</h1>` +
    portInUseMessage({ appName, port }).map((line) => `<p>${escapeHtml(line)}</p>`).join('') +
    '<button id="retry" type="button">Try again</button>';
  return page(`${appName} couldn't start`, body, RETRY_SCRIPT);
}

function failedPageHtml({ appName }) {
  const body =
    `<h1>${escapeHtml(appName)} couldn't start</h1>` +
    `<p>${escapeHtml(`Something stopped ${appName} from starting. Press Try again. If it keeps happening, restart the computer, then contact support.`)}</p>` +
    '<button id="retry" type="button">Try again</button>';
  return page(`${appName} couldn't start`, body, RETRY_SCRIPT);
}

/**
 * A data: URL for one of the local pages ('starting', 'port-in-use', 'failed').
 * Pure.
 */
function backendPageUrl(content, { appName, port }) {
  if (content === 'port-in-use') return toDataUrl(portInUsePageHtml({ appName, port }));
  if (content === 'failed') return toDataUrl(failedPageHtml({ appName }));
  return toDataUrl(startingPageHtml({ appName }));
}

/**
 * MAIN SIDE, all of the above wired together. Owns what the window shows:
 * a local "Starting..." page, then the app URL once our server is listening, or
 * the port-in-use page with Try again. Registers the 'backend:retry' IPC handler.
 *
 *   const backendWindow = createBackendWindowGuard({
 *     appName: 'HarborSentinel', port: 3000, ipcMain,
 *     getMainWindow: () => mainWindow,
 *     loadApp: (win) => win.loadURL('http://localhost:3000'),
 *   });
 *   // in createWindow(), where the window used to loadURL the app:
 *   backendWindow.show();
 *
 * Call show() once per new window, when it is ready to load (after any storage
 * clearing). After that the guard follows the listen state by itself. The app is
 * loaded at most once per window: a later state change never navigates away from
 * the running app, so nothing in the page is thrown away.
 *
 * @param {object} opts
 * @param {string} opts.appName
 * @param {number} opts.port
 * @param {import('electron').IpcMain} opts.ipcMain
 * @param {() => import('electron').BrowserWindow | null} opts.getMainWindow
 * @param {(win: import('electron').BrowserWindow) => unknown} opts.loadApp
 */
function createBackendWindowGuard({ appName, port, ipcMain, getMainWindow, loadApp }) {
  // What the current window is showing; 'none' until show() for that window.
  let shown = 'none';
  let shownWindow = null;

  function currentWindow() {
    const win = getMainWindow();
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return null;
    return win;
  }

  function render(content) {
    const win = currentWindow();
    if (!win) return;
    if (win !== shownWindow) return; // show() has not been called for this window yet
    if (shown === content) return;
    if (shown === 'app') return; // never navigate away from the running app
    shown = content;
    if (content === 'app') {
      console.log(`[Window] Our backend is listening and answers on localhost; loading http://localhost:${port}`);
      Promise.resolve(loadApp(win)).catch((err) => console.error('[Window] Loading the app failed:', err));
    } else {
      Promise.resolve(win.loadURL(backendPageUrl(content, { appName, port }))).catch(() => {});
    }
  }

  const unsubscribe = onBackendListenState(port, ({ state }) => render(backendWindowContent(state)));

  if (ipcMain) ipcMain.on('backend:retry', () => retryBackendListen(port));

  return {
    /** Load the right content into the current window. Call once per new window. */
    show() {
      const win = currentWindow();
      if (!win) return;
      shownWindow = win;
      shown = 'none';
      render(backendWindowContent(getBackendListenState(port).state));
    },
    /** What the current window is showing: 'none'|'starting'|'app'|'port-in-use'|'failed'. */
    content() {
      return currentWindow() === shownWindow ? shown : 'none';
    },
    dispose() {
      unsubscribe();
      if (ipcMain && typeof ipcMain.removeAllListeners === 'function') ipcMain.removeAllListeners('backend:retry');
    }
  };
}

/** Test hook: forget every tracked port, and abandon any probe in flight. */
function _resetBackendListenRegistry() {
  for (const entry of registry().values()) entry.generation += 1;
  registry().clear();
}

module.exports = {
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
};
