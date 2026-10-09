/**
 * Keeps the app window on the app.
 *
 * Every window an app opens carries its preload bridge (window.appUpdater,
 * window.appBackend, ...), so the only page that may hold it is the app's own.
 * Before this, each app's main.cjs allowed a child window when the URL merely
 * started with 'http://localhost:<port>' -- which 'http://localhost:3000.evil.com'
 * and 'http://localhost:3001@evil.example/' both do -- handed everything else to
 * shell.openExternal whatever its scheme (file:, ms-settings:, ...), and had no
 * guard at all on the main window navigating away.
 *
 * installWindowGuards() replaces that with one rule, compared on the parsed
 * origin rather than on a string prefix:
 *
 *   - window.open / target=_blank: allowed only for the app's own origin. Any
 *     other URL is denied, and opened in the system browser when its scheme is
 *     one of `externalSchemes` (http:, https:, mailto: by default). Other schemes
 *     are denied and logged by scheme only, never by URL.
 *   - will-navigate (the main window following a link or a script setting
 *     location): the app's own origin proceeds; anything else is cancelled and
 *     opened externally under the same scheme rule. data: URLs proceed, because
 *     the busy-port pages in backendPort.js are data: pages. Those are loaded with
 *     loadURL(), which does not emit will-navigate at all, so this is belt and
 *     braces rather than load-bearing.
 *
 * Nothing here requires 'electron' unless no `shell` is passed, so it is unit
 * testable with a fake window.
 */

const DEFAULT_EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:'];

function parseUrl(url) {
  if (typeof url !== 'string' || url === '') return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Installs the window-open handler and the will-navigate guard on `window`.
 * Call once per BrowserWindow, in createWindow(), in place of the app's own
 * setWindowOpenHandler.
 *
 * @param {import('electron').BrowserWindow} window
 * @param {object} opts
 * @param {string} opts.appUrl  The URL the window loads the app from, e.g.
 *   'http://localhost:3000'. Only its origin is used.
 * @param {string[]} [opts.externalSchemes]  Schemes (with the colon) that may be
 *   handed to the system. Defaults to ['http:', 'https:', 'mailto:'].
 * @param {Pick<import('electron').Shell, 'openExternal'>} [opts.shell]  Defaults
 *   to Electron's shell, required lazily.
 */
function installWindowGuards(window, { appUrl, externalSchemes = DEFAULT_EXTERNAL_SCHEMES, shell } = {}) {
  const app = parseUrl(appUrl);
  if (!app || app.origin === 'null') {
    throw new TypeError('installWindowGuards: appUrl must be an absolute URL with an origin, e.g. http://localhost:3000');
  }
  const appOrigin = app.origin;
  const schemes = new Set(externalSchemes.map((s) => String(s).toLowerCase()));

  function getShell() {
    return shell || require('electron').shell;
  }

  /** Hands `target` to the system browser if its scheme is allowed; otherwise logs the scheme. */
  function openExternally(target, url, via) {
    if (!schemes.has(target.protocol)) {
      console.warn(`[Window] Blocked ${via} to a ${target.protocol} URL; not opening it.`);
      return;
    }
    try {
      Promise.resolve(getShell().openExternal(url)).catch((err) => {
        console.warn(`[Window] Could not open a ${target.protocol} link externally:`, err?.message || err);
      });
    } catch (err) {
      console.warn(`[Window] Could not open a ${target.protocol} link externally:`, err?.message || err);
    }
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = parseUrl(url);
    if (target && target.origin === appOrigin) return { action: 'allow' };
    if (target) openExternally(target, url, 'a new window');
    else console.warn('[Window] Blocked a new window for a URL that does not parse.');
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, legacyUrl) => {
    // Electron 25+ puts the URL on the event; the second argument is the older form.
    const url = (event && typeof event.url === 'string' && event.url) || legacyUrl;
    const target = parseUrl(url);
    if (target && (target.origin === appOrigin || target.protocol === 'data:')) return;
    event.preventDefault();
    if (target) openExternally(target, url, 'a navigation');
    else console.warn('[Window] Blocked a navigation to a URL that does not parse.');
  });
}

module.exports = {
  installWindowGuards,
  DEFAULT_EXTERNAL_SCHEMES
};
