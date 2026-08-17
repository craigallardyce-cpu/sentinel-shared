/**
 * Shared Electron main-process building blocks for the Mariner Sentinel fleet.
 *
 * Deliberately does NOT unify createWindow() or backend-startup — those carry
 * real per-app differences (close-to-tray vs. real close, external-link policy,
 * in-process require() vs. forked+supervised backend) that aren't safe to force
 * into one function. What's extracted here is genuinely identical across all
 * three apps: the auto-updater IPC wiring, the Linux GPU compatibility guard,
 * window diagnostic logging, the DevTools toggle, tray creation, and the power
 * save blocker.
 */

/**
 * ChromeOS Crostini / containerized Linux compatibility: the GPU subprocess
 * crashes fatally in these environments. disableHardwareAcceleration() forces
 * software rendering; the command-line switches avoid spawning a GPU subprocess
 * that would crash. No-op on non-Linux platforms.
 */
function applyLinuxGpuCompatibility(app) {
  if (process.platform !== 'linux') return;
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
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
  window.webContents.on('crashed', () => {
    console.error('[Window] Renderer CRASHED');
  });
  window.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.log('[Renderer Console]', message);
  });
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
 */
function setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow, onBeforeInstall }) {
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

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo || null;
    } catch (err) {
      console.error('[Updater] Check failed:', err);
      return null;
    }
  });

  ipcMain.handle('updater:install', () => {
    if (!updateDownloaded) {
      return { ok: false, error: 'No update downloaded yet.' };
    }
    if (onBeforeInstall) onBeforeInstall();
    autoUpdater.quitAndInstall();
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
}

module.exports = {
  applyLinuxGpuCompatibility,
  attachWindowDiagnostics,
  enableDevToolsToggle,
  startPowerSaveBlocker,
  createAppTray,
  setupAutoUpdater
};
