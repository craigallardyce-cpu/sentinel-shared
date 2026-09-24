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
 * Nothing in this file requires 'electron', so the server may import it when it
 * runs standalone under plain Node too.
 */

const REGISTRY_KEY = Symbol.for('@sentinel/electron-shell/backend-listen');

/**
 * Listen states, per port:
 *   'waiting'     -- nothing has reported yet, or a retry is in flight.
 *   'listening'   -- our server holds the port; the app URL is ours to load.
 *   'port-in-use' -- another program holds the port (EADDRINUSE), or the OS
 *                    refuses it to us (EACCES: on Windows, a port inside a range
 *                    reserved by Hyper-V/WSL fails this way rather than as in-use).
 *   'failed'      -- listen failed for some other reason.
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
    entry = { port: key, state: 'waiting', code: null, server: null, host: undefined, listeners: new Set() };
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
 * @param {import('net').Server} server
 * @param {object} opts
 * @param {number} opts.port  The port passed to listen(). Must not be 0.
 * @param {string} [opts.host] The host passed to listen(), if any ('0.0.0.0').
 */
function trackBackendListen(server, { port, host } = {}) {
  if (!server || typeof server.on !== 'function') {
    throw new TypeError('trackBackendListen: a net/http Server is required');
  }
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) {
    throw new TypeError('trackBackendListen: a fixed, non-zero port is required');
  }
  const entry = entryFor(port);
  entry.server = server;
  entry.host = host;
  if (server.listening) {
    setState(entry, 'listening');
  } else if (entry.state !== 'waiting') {
    setState(entry, 'waiting');
  }

  server.on('listening', () => {
    setState(entry, 'listening');
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
    setState(entry, state, (err && err.code) || null);
  });
}

/**
 * MAIN SIDE. The current listen state for `port`.
 * @returns {{ port: number, state: 'waiting'|'listening'|'port-in-use'|'failed', code: string|null }}
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
 * MAIN SIDE. One more attempt to listen on the same port, after 'port-in-use' or
 * 'failed'. The server's original listen() callback is still registered (Node
 * adds it as a once('listening') handler), so the app's startup work runs when a
 * retry succeeds. Returns true if an attempt was started.
 */
function retryBackendListen(port) {
  const entry = entryFor(port);
  if (!entry.server) return false;
  if (entry.state !== 'port-in-use' && entry.state !== 'failed') return false;
  console.log(`[Backend] Trying port ${entry.port} again at the user's request.`);
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
 * network, and only once our own server is listening.
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
      console.log(`[Window] Our backend is listening; loading http://localhost:${port}`);
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

/** Test hook: forget every tracked port. */
function _resetBackendListenRegistry() {
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
  _resetBackendListenRegistry
};
