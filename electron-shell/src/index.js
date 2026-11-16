/**
 * Shared Electron main-process building blocks for the Mariner Sentinel fleet.
 *
 * Deliberately does NOT unify createWindow() or backend-startup — those carry
 * real per-app differences (close-to-tray vs. real close, external-link policy,
 * in-process require() vs. forked+supervised backend) that aren't safe to force
 * into one function. What's extracted here is genuinely identical across all
 * three apps: the auto-updater IPC wiring, the Linux GPU compatibility guard,
 * the single-instance lock, window diagnostic logging, the DevTools toggle,
 * tray creation, the power save blocker, and the hidden title bar. The
 * window-open and navigation guards (windowGuards.js) are shared too: each
 * app's own external-link handler had the same origin bug.
 */

/**
 * ChromeOS Crostini / containerized Linux compatibility: the GPU subprocess
 * crashes fatally in these environments. disableHardwareAcceleration() forces
 * software rendering; the command-line switches avoid spawning a GPU subprocess
 * that would crash. No-op on non-Linux platforms.
 *
 * Applied on every Linux machine, not only ChromeOS, and that includes
 * `no-sandbox`. The 2026-10-08 runtime review asked whether to gate it on
 * Crostini; the answer was no, untested. An AppImage cannot ship Chromium's
 * setuid sandbox helper, and distributions that restrict unprivileged user
 * namespaces (Ubuntu 23.10 onwards, by default) take away the other sandbox
 * too, so dropping the switch risks the app not starting at all. Change this
 * only with a launch test of the packaged AppImage on such a distribution.
 *
 * Returns false when the app is being restarted on X11 (see `relaunchOnX11`)
 * and true otherwise. Callers that ignore the result are unaffected: the
 * process ends inside this call when a restart is arranged.
 */
function applyLinuxGpuCompatibility(app, { env = process.env, argv = process.argv } = {}) {
  if (process.platform !== 'linux') return true;
  if (relaunchOnX11(app, { env, argv })) return false;
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  return true;
}

const X11_SWITCH = '--ozone-platform=x11';

/**
 * Whether this start should be handed to a fresh process on X11.
 *
 * `appendSwitch('ozone-platform', 'x11')` above reaches only the child
 * processes: by the time any JavaScript runs, the main process has already
 * chosen Wayland where a Wayland session exists, and on ChromeOS the window
 * then never appears although the page loads (roadmap #135). The installed
 * launchers carry the switch on their command line, so this is about every
 * other way in: a terminal, an AppImage run directly, a file manager.
 *
 * True only when all of these hold: no `--ozone-platform` on the command line
 * (one naming Wayland is somebody's deliberate choice and is left alone); a
 * Wayland session; an X display to go to; this process is not itself the
 * restarted one; and `SENTINEL_NO_X11_RELAUNCH=1` is not set.
 */
function needsX11Relaunch({ env = process.env, argv = process.argv, platform = process.platform } = {}) {
  if (platform !== 'linux') return false;
  if (env.SENTINEL_NO_X11_RELAUNCH === '1' || env.SENTINEL_X11_RELAUNCHED === '1') return false;
  if (env.ELECTRON_RUN_AS_NODE) return false;
  if (argv.some((arg) => typeof arg === 'string' && arg.startsWith('--ozone-platform'))) return false;
  const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === 'wayland';
  return wayland && Boolean(env.DISPLAY);
}

/**
 * Restarts the app once with the X11 switch on its command line, when
 * `needsX11Relaunch` says so. Returns true when the restart is under way, and
 * the caller must do nothing more; `app.exit` before 'ready' ends the process
 * there and then, so in practice nothing after this runs.
 *
 * An AppImage is restarted through the AppImage file itself (`APPIMAGE`), not
 * the executable inside its mount, which is gone once this process exits. The
 * marker in the environment is what stops a loop if the new process still does
 * not see the switch. A restart that cannot be arranged is logged and the app
 * carries on as it would have before.
 */
function relaunchOnX11(app, { env = process.env, argv = process.argv } = {}) {
  if (!needsX11Relaunch({ env, argv })) return false;
  if (typeof app.relaunch !== 'function' || typeof app.exit !== 'function') return false;
  try {
    env.SENTINEL_X11_RELAUNCHED = '1';
    app.relaunch({
      args: argv.slice(1).concat(X11_SWITCH),
      ...(env.APPIMAGE ? { execPath: env.APPIMAGE } : {})
    });
    console.log('[Linux] Started on Wayland without', X11_SWITCH + '; restarting with it.');
    app.exit(0);
    return true;
  } catch (err) {
    delete env.SENTINEL_X11_RELAUNCHED;
    console.error('[Linux] Could not restart on X11; continuing:', err);
    return false;
  }
}

/**
 * Claims the single-instance lock, returning false if another instance already
 * holds it. The caller is expected to stop immediately when it returns false:
 *
 *   if (!claimSingleInstanceLock(app, { getMainWindow: () => mainWindow })) return;
 *
 * All three apps start a backend on a fixed port and load their window from it
 * (5001 / 3000 / 3001). A duplicate instance therefore cannot work: it fails to
 * bind, silently attaches to the first instance's server and renders THAT build,
 * while both processes contend for the same Chromium profile under userData --
 * "Unable to move the cache: Access is denied", "Failed to delete the database".
 * The visible result is a blank white window rather than any actionable error,
 * and it is easy to hit by running a dev build while the installed app is up.
 *
 * Claim this BEFORE starting the backend, so the losing instance exits without
 * opening a database pool or reaching for the port.
 *
 * Launching again is also how someone gets back to a window closed to the tray,
 * so a second launch shows and focuses the existing window.
 *
 * Note this only protects against instances that also call it -- an installed
 * build predating its adoption holds no lock to lose.
 *
 * @param {import('electron').App} app
 * @param {object} [opts]
 * @param {() => import('electron').BrowserWindow | null} [opts.getMainWindow]
 * @returns {boolean} true if this process owns the lock and should continue.
 */
function claimSingleInstanceLock(app, { getMainWindow } = {}) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const window = getMainWindow ? getMainWindow() : null;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  return true;
}

/** Attaches standard diagnostic logging to a BrowserWindow's webContents. */
function attachWindowDiagnostics(window) {
  window.webContents.on('did-start-loading', () => {
    console.log('[Window] did-start-loading');
  });
  window.webContents.on('did-finish-load', () => {
    console.log('[Window] did-finish-load — page loaded successfully');
  });
  window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Window] did-fail-load:', errorCode, errorDescription, validatedURL);
  });
  window.webContents.on('dom-ready', () => {
    console.log('[Window] dom-ready — DOM is ready');
  });
  window.webContents.on('render-process-gone', (event, details) => {
    console.error('[Window] render-process-gone:', details.reason, details.exitCode);
  });
  // One named parameter: Electron warns about the deprecated form by the
  // listener's arity, and a rest parameter does not count towards it.
  window.webContents.on('console-message', (event, ...legacy) => {
    if (isWarningOrError(event, legacy[0])) {
      console.log('[Renderer Console]', typeof event?.message === 'string' ? event.message : legacy[1]);
    }
  });
}

/**
 * Electron 35 moved console-message's details onto the event and made `level`
 * a string ('debug' | 'info' | 'warning' | 'error'); the positional arguments,
 * where `level` was 0-3 and 2 meant warning, are deprecated. Reading the event
 * first keeps the deprecation warning out of the log on current Electron, and
 * the fallback keeps an app still on an older major logging as before.
 */
function isWarningOrError(event, legacyLevel) {
  if (typeof event?.level === 'string') return event.level === 'warning' || event.level === 'error';
  return legacyLevel >= 2;
}

/** Enables F12 / Ctrl+Shift+I to toggle DevTools on a BrowserWindow. */
function enableDevToolsToggle(window) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I')) {
      window.webContents.toggleDevTools();
      if (event.preventDefault) event.preventDefault();
    }
  });
}

/**
 * Starts the permanent power save blocker (prevents system sleep). Returns the
 * blocker id, or null if it failed to start.
 */
function startPowerSaveBlocker() {
  try {
    const { powerSaveBlocker } = require('electron');
    const id = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[Power] Started power save blocker (prevent system sleep):', id);
    return id;
  } catch (err) {
    console.error('[Power] Failed to start power save blocker:', err);
    return null;
  }
}

/**
 * Creates a system tray icon with a standard "Show App" / "Quit" menu.
 * Returns the Tray instance, or null if creation failed.
 */
function createAppTray({ iconPath, tooltip, onShow, onQuit }) {
  const { Tray, Menu } = require('electron');
  try {
    const tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show App', click: () => { if (onShow) onShow(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { if (onQuit) onQuit(); } }
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip(tooltip);
    tray.on('click', () => { if (onShow) onShow(); });
    console.log('[Tray] System tray icon initialized successfully.');
    return tray;
  } catch (trayErr) {
    console.error('[Tray] Failed to create tray icon:', trayErr);
    return null;
  }
}

/**
 * Wires electron-updater to the renderer over IPC (paired with each app's
 * preload.cjs, which exposes window.appUpdater backed by these same channels).
 * Byte-identical logic across all three apps before this extraction.
 *
 * @param {object} opts
 * @param {import('electron').App} opts.app
 * @param {import('electron-updater').AppUpdater} opts.autoUpdater
 * @param {import('electron').IpcMain} opts.ipcMain
 * @param {() => import('electron').BrowserWindow | null} opts.getMainWindow
 * @param {() => void} [opts.onBeforeInstall] - called just before quitAndInstall
 *   (e.g. VesselKeeper stops its forked backend process here first).
 * @param {(err: Error) => void} [opts.onInstallFailed] - called when the install
 *   did not happen after all, to undo what onBeforeInstall did (VesselKeeper
 *   starts its backend again). The renderer is sent an `error` updater event
 *   either way.
 * @param {number} [opts.installTimeoutMs] - how long after asking to quit the
 *   app may still be running before the install counts as failed. Default 15 s.
 * @param {number} [opts.periodicCheckMs] - when set, and the app is packaged,
 *   checks for updates in the background once now and then every this many ms
 *   (checkForUpdatesAndNotify), on one process-wide timer. Left out, nothing is
 *   checked in the background, as before.
 */
function setupAutoUpdater({
  app,
  autoUpdater,
  ipcMain,
  getMainWindow,
  onBeforeInstall,
  onInstallFailed,
  installTimeoutMs = 15000,
  periodicCheckMs
}) {
  if (periodicCheckMs !== undefined && !(Number.isFinite(periodicCheckMs) && periodicCheckMs > 0)) {
    throw new TypeError('setupAutoUpdater: periodicCheckMs must be a positive number of milliseconds');
  }
  if (!(Number.isFinite(installTimeoutMs) && installTimeoutMs > 0)) {
    throw new TypeError('setupAutoUpdater: installTimeoutMs must be a positive number of milliseconds');
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let updateDownloaded = false;

  function sendUpdaterEvent(type, payload) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:event', { type, ...payload });
    }
  }

  ipcMain.handle('updater:get-version', () => app.getVersion());

  // Every check must end in an event: the renderer shows "Checking…" until one
  // arrives. electron-updater sends none when it skips the check -- an
  // unpackaged run (`electron .`) resolves null without asking anyone -- and a
  // rejected promise is not guaranteed one either, so both are reported here.
  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) {
        // Not a failure: there is nothing to check here. `unavailable` is shown as
        // a neutral note, where `error` drew a red "Error" in About (5 Oct).
        sendUpdaterEvent('unavailable', {
          message: app.isPackaged
            ? 'Update checks are turned off in this build.'
            : 'Updates are checked by the installed app, not a development run.'
        });
        return null;
      }
      return result.updateInfo || null;
    } catch (err) {
      console.error('[Updater] Check failed:', err);
      sendUpdaterEvent('error', { message: err?.message || String(err) });
      return null;
    }
  });

  // Installing has a way back. `onBeforeInstall` is where an app shuts things
  // down (VesselKeeper stops its backend), and until now nothing undid that
  // when the install then did not happen: the app stayed up with a dead
  // backend and no message. Two ways it does not happen. Either call throws;
  // or quitAndInstall returns normally having failed to start the installer,
  // which electron-updater only logs. The second cannot be seen from here, so
  // it is inferred: an app still running `installTimeoutMs` after asking to
  // quit did not quit.
  let installTimer = null;

  function installFailed(err) {
    if (installTimer) {
      clearTimeout(installTimer);
      installTimer = null;
    }
    const message = err?.message || String(err);
    console.error('[Updater] Install did not start:', err);
    if (onInstallFailed) {
      try {
        onInstallFailed(err);
      } catch (hookErr) {
        console.error('[Updater] onInstallFailed threw:', hookErr);
      }
    }
    sendUpdaterEvent('error', { message });
    return message;
  }

  ipcMain.handle('updater:install', () => {
    if (!updateDownloaded) {
      return { ok: false, error: 'No update downloaded yet.' };
    }
    // A second press while the first is still on its way out.
    if (installTimer) return { ok: true };
    try {
      if (onBeforeInstall) onBeforeInstall();
      autoUpdater.quitAndInstall();
    } catch (err) {
      return { ok: false, error: installFailed(err) };
    }
    installTimer = setTimeout(() => {
      installTimer = null;
      installFailed(new Error('The update could not be installed. The app is still running; try again.'));
    }, installTimeoutMs);
    // Never the reason the process stays alive.
    if (typeof installTimer.unref === 'function') installTimer.unref();
    return { ok: true };
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
    sendUpdaterEvent('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    sendUpdaterEvent('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available.');
    sendUpdaterEvent('not-available', { version: info?.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterEvent('download-progress', { percent: progress.percent });
  });

  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
    sendUpdaterEvent('error', { message: err?.message || String(err) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version || 'latest';
    console.log('[Updater] Update downloaded; ready to install:', version);
    updateDownloaded = true;
    sendUpdaterEvent('downloaded', { version });
  });

  if (periodicCheckMs !== undefined && app.isPackaged) {
    startPeriodicUpdateCheck({ app, autoUpdater, periodicCheckMs });
  }
}

// One timer for the whole process, however many times setupAutoUpdater runs.
// The apps used to start an interval inside createWindow(), so every re-created
// window (macOS 'activate') added another.
let periodicUpdateTimer = null;

/**
 * One background check now (once the app is ready: electron-updater's network
 * requests need it), then one every `periodicCheckMs`. A failed check is
 * caught and logged as a warning here; the renderer already hears of it,
 * because electron-updater emits 'error' before rejecting, and the 'error'
 * listener above forwards that as an updater:event.
 */
function startPeriodicUpdateCheck({ app, autoUpdater, periodicCheckMs }) {
  _stopPeriodicUpdateCheck();
  const whenReady = typeof app.whenReady === 'function' ? () => app.whenReady() : () => Promise.resolve();
  const check = () => {
    whenReady()
      .then(() => autoUpdater.checkForUpdatesAndNotify())
      .catch((err) => {
        console.warn('[Updater] Background update check failed:', err?.message || err);
      });
  };
  check();
  periodicUpdateTimer = setInterval(check, periodicCheckMs);
  if (typeof periodicUpdateTimer.unref === 'function') periodicUpdateTimer.unref();
}

function _stopPeriodicUpdateCheck() {
  if (periodicUpdateTimer) clearInterval(periodicUpdateTimer);
  periodicUpdateTimer = null;
}

/**
 * The window controls overlay, and the two palettes it is painted in.
 *
 * The native title bar is hidden on desktop: the app's own header is the
 * bar now, so the OS no longer prints the product name a second time forty
 * pixels above it. What remains of the frame is the OS's minimise / maximise /
 * close cluster, painted at the top-right over the page at this height. The
 * renderer reads `env(titlebar-area-height)` to keep its floating header
 * clear of the cluster (theme/shell.css), and makes the strip above the
 * header a drag region.
 *
 * Colours are the fleet's tokens, spelt out because the main process cannot
 * read a stylesheet: --bg-app / --text-primary by day, and their night-mode
 * values from theme/night.css after dark, so the cluster is not the one thing
 * on a red screen that stays blue-grey.
 */
const TITLE_BAR_OVERLAY_HEIGHT = 32;
const TITLE_BAR_PALETTES = {
  day: { color: '#081425', symbolColor: '#d8e3fb' },
  night: { color: '#090202', symbolColor: '#ff9e9e' }
};

/**
 * BrowserWindow options that hide the native title bar behind the app's own
 * header. Spread into `new BrowserWindow({...})`.
 *
 *   mainWindow = new BrowserWindow({ ...hiddenTitleBarOptions(), width: 1280, ... });
 *
 * On Windows and Linux this leaves the OS window-controls cluster painted over
 * the page; on macOS it leaves the traffic lights, moved down to sit inside
 * the same strip.
 */
function hiddenTitleBarOptions() {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLE_BAR_PALETTES.day, height: TITLE_BAR_OVERLAY_HEIGHT },
    trafficLightPosition: { x: 12, y: 8 }
  };
}

/**
 * Repaints the window-controls cluster when the renderer switches night mode.
 * Paired with each app's preload.cjs, which exposes window.appShell.setNightMode
 * on the `shell:night-mode` channel; @sentinel/ui's AppShell calls it whenever
 * it toggles `theme-night`. macOS traffic lights are native and cannot be
 * recoloured, so the call is a no-op there.
 *
 * @param {object} opts
 * @param {import('electron').IpcMain} opts.ipcMain
 * @param {() => import('electron').BrowserWindow | null} opts.getMainWindow
 */
function setupTitleBarOverlay({ ipcMain, getMainWindow }) {
  ipcMain.on('shell:night-mode', (_event, night) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || typeof window.setTitleBarOverlay !== 'function') return;
    try {
      window.setTitleBarOverlay({
        ...TITLE_BAR_PALETTES[night ? 'night' : 'day'],
        height: TITLE_BAR_OVERLAY_HEIGHT
      });
    } catch (err) {
      // Not every platform paints an overlay (macOS); nothing to repaint there.
      console.warn('[Window] Title bar overlay could not be repainted:', err?.message || err);
    }
  });
}

// Busy-port handling for an in-process backend; see backendPort.js. Destructured
// into plain names so the export list below stays shorthand-only, which is what
// Node's CJS named-export detection needs when an ESM server imports this.
const {
  trackBackendListen,
  getBackendListenState,
  onBackendListenState,
  retryBackendListen,
  backendWindowContent,
  backendPageUrl,
  portInUseMessage,
  createBackendWindowGuard,
  probeBackendToken,
  localPageUrl
} = require('./backendPort.js');
const { installWindowGuards } = require('./windowGuards.js');

module.exports = {
  applyLinuxGpuCompatibility,
  needsX11Relaunch,
  relaunchOnX11,
  claimSingleInstanceLock,
  attachWindowDiagnostics,
  enableDevToolsToggle,
  startPowerSaveBlocker,
  createAppTray,
  setupAutoUpdater,
  hiddenTitleBarOptions,
  setupTitleBarOverlay,
  trackBackendListen,
  getBackendListenState,
  onBackendListenState,
  retryBackendListen,
  backendWindowContent,
  backendPageUrl,
  portInUseMessage,
  createBackendWindowGuard,
  probeBackendToken,
  localPageUrl,
  installWindowGuards,
  _stopPeriodicUpdateCheck
};
