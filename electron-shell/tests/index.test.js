import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyLinuxGpuCompatibility,
  attachWindowDiagnostics,
  claimSingleInstanceLock,
  setupAutoUpdater,
  _stopPeriodicUpdateCheck
} from '../src/index.js';

function fakeApp() {
  return {
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    getVersion: vi.fn(() => '1.2.3')
  };
}

describe('applyLinuxGpuCompatibility', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('is a no-op on non-Linux platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const app = fakeApp();
    applyLinuxGpuCompatibility(app);
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('disables hardware acceleration and appends compatibility switches on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const app = fakeApp();
    applyLinuxGpuCompatibility(app);
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    const switches = app.commandLine.appendSwitch.mock.calls.map(c => c[0]);
    expect(switches).toContain('no-sandbox');
    expect(switches).toContain('disable-gpu');
    expect(switches).toContain('disable-dev-shm-usage');
  });
});

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
    invoke: (channel, ...args) => handlers.get(channel)(...args)
  };
}

function fakeAutoUpdater() {
  const listeners = new Map();
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '2.0.0' } })),
    quitAndInstall: vi.fn(),
    on: vi.fn((event, fn) => listeners.set(event, fn)),
    emit: (event, payload) => listeners.get(event)(payload)
  };
}

describe('setupAutoUpdater', () => {
  let app, ipcMain, autoUpdater, sentEvents, mainWindow;

  beforeEach(() => {
    app = fakeApp();
    ipcMain = fakeIpcMain();
    autoUpdater = fakeAutoUpdater();
    sentEvents = [];
    mainWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn((channel, data) => sentEvents.push(data)) }
    };
  });

  it('configures autoDownload and autoInstallOnAppQuit', () => {
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow });
    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it('forwards autoUpdater events to the renderer as updater:event', () => {
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow });
    autoUpdater.emit('update-available', { version: '2.0.0' });
    expect(sentEvents).toContainEqual({ type: 'available', version: '2.0.0' });

    autoUpdater.emit('download-progress', { percent: 42 });
    expect(sentEvents).toContainEqual({ type: 'download-progress', percent: 42 });
  });

  it('does not throw when the window is gone (destroyed/null)', () => {
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => null });
    expect(() => autoUpdater.emit('checking-for-update')).not.toThrow();
  });

  it('updater:install refuses to install before a download completed', async () => {
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow });
    const result = await ipcMain.invoke('updater:install');
    expect(result).toEqual({ ok: false, error: 'No update downloaded yet.' });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('updater:install succeeds once update-downloaded has fired, and calls onBeforeInstall first', async () => {
    const callOrder = [];
    const onBeforeInstall = vi.fn(() => callOrder.push('onBeforeInstall'));
    autoUpdater.quitAndInstall = vi.fn(() => callOrder.push('quitAndInstall'));

    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow, onBeforeInstall });
    autoUpdater.emit('update-downloaded', { version: '2.0.0' });

    const result = await ipcMain.invoke('updater:install');
    expect(result).toEqual({ ok: true });
    expect(callOrder).toEqual(['onBeforeInstall', 'quitAndInstall']);
  });

  it('updater:get-version reads from app.getVersion()', async () => {
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow });
    const version = await ipcMain.invoke('updater:get-version');
    expect(version).toBe('1.2.3');
  });

  it('updater:check returns updateInfo on success and null on failure', async () => {
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow });
    const ok = await ipcMain.invoke('updater:check');
    expect(ok).toEqual({ version: '2.0.0' });

    autoUpdater.checkForUpdates = vi.fn(async () => { throw new Error('network down'); });
    const failed = await ipcMain.invoke('updater:check');
    expect(failed).toBeNull();
    expect(sentEvents).toContainEqual({ type: 'error', message: 'network down' });
  });

  it('updater:check ends in an unavailable event, not an error, when electron-updater skips the check (unpackaged run)', async () => {
    // electron-updater resolves null and emits nothing when the app is not
    // packaged; without an event the renderer shows "Checking…" forever. It is
    // not a failure, so it must not be `error` (which drew a red Error pill).
    autoUpdater.checkForUpdates = vi.fn(async () => null);
    app.isPackaged = false;
    setupAutoUpdater({ app, autoUpdater, ipcMain, getMainWindow: () => mainWindow });
    const result = await ipcMain.invoke('updater:check');
    expect(result).toBeNull();
    expect(sentEvents).toContainEqual({
      type: 'unavailable',
      message: 'Updates are checked by the installed app, not a development run.'
    });
    expect(sentEvents.some((e) => e.type === 'error')).toBe(false);
  });
});

describe('setupAutoUpdater periodicCheckMs', () => {
  const HOUR = 60 * 60 * 1000;
  let app, autoUpdater, warn, unhandled;
  const onUnhandled = (reason) => unhandled.push(reason);

  // A fresh ipcMain per call: the real one throws on a second handle() for a
  // channel, but these tests call setupAutoUpdater twice on purpose.
  const setup = (opts) => setupAutoUpdater({
    app, autoUpdater, ipcMain: fakeIpcMain(), getMainWindow: () => null, ...opts
  });

  beforeEach(() => {
    vi.useFakeTimers();
    app = { ...fakeApp(), isPackaged: true, whenReady: vi.fn(() => Promise.resolve()) };
    autoUpdater = { ...fakeAutoUpdater(), checkForUpdatesAndNotify: vi.fn(async () => null) };
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    _stopPeriodicUpdateCheck();
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts no timer and checks nothing when left out (as before)', async () => {
    setup();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(vi.getTimerCount()).toBe(0);
    expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
  });

  it('starts no timer in an unpackaged run', async () => {
    app.isPackaged = false;
    setup({ periodicCheckMs: HOUR });
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(vi.getTimerCount()).toBe(0);
    expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
  });

  it('checks once when the app is ready, then once per period', async () => {
    setup({ periodicCheckMs: HOUR });
    await vi.advanceTimersByTimeAsync(0);
    expect(app.whenReady).toHaveBeenCalled();
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(3);
  });

  it('keeps one timer however many times it is set up', async () => {
    setup({ periodicCheckMs: HOUR });
    setup({ periodicCheckMs: HOUR });
    setup({ periodicCheckMs: HOUR });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    const initial = autoUpdater.checkForUpdatesAndNotify.mock.calls.length;
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(autoUpdater.checkForUpdatesAndNotify.mock.calls.length - initial).toBe(1);
  });

  it('catches a rejecting check: a warning, never an unhandled rejection', async () => {
    autoUpdater.checkForUpdatesAndNotify = vi.fn(async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); });
    setup({ periodicCheckMs: HOUR });
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    // Let Node deliver any unhandled-rejection event before looking.
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20));
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(3);
    expect(unhandled).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[Updater] Background update check failed:', 'net::ERR_INTERNET_DISCONNECTED');
  });

  it('refuses a period that is not a positive number', () => {
    for (const periodicCheckMs of [0, -1, NaN, Infinity, '3600000']) {
      expect(() => setup({ periodicCheckMs })).toThrow(TypeError);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('attachWindowDiagnostics', () => {
  it('listens for render-process-gone and not the removed crashed event', () => {
    const events = [];
    attachWindowDiagnostics({ webContents: { on: (event) => events.push(event) } });
    expect(events).toContain('render-process-gone');
    expect(events).not.toContain('crashed');
  });
});

describe('claimSingleInstanceLock', () => {
  function lockableApp(gotLock) {
    const handlers = {};
    return {
      requestSingleInstanceLock: vi.fn(() => gotLock),
      quit: vi.fn(),
      on: vi.fn((event, fn) => { handlers[event] = fn; }),
      emit: (event) => handlers[event] && handlers[event]()
    };
  }

  function fakeWindow(overrides = {}) {
    return {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      ...overrides
    };
  }

  it('returns true and does not quit when the lock is acquired', () => {
    const app = lockableApp(true);
    expect(claimSingleInstanceLock(app)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('quits and returns false when another instance holds the lock', () => {
    const app = lockableApp(false);
    expect(claimSingleInstanceLock(app)).toBe(false);
    expect(app.quit).toHaveBeenCalled();
  });

  it('does not register a second-instance handler when it lost the lock', () => {
    const app = lockableApp(false);
    claimSingleInstanceLock(app, { getMainWindow: () => fakeWindow() });
    expect(app.on).not.toHaveBeenCalled();
  });

  it('shows and focuses the existing window on a second launch', () => {
    const app = lockableApp(true);
    const window = fakeWindow();
    claimSingleInstanceLock(app, { getMainWindow: () => window });
    app.emit('second-instance');
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.restore).not.toHaveBeenCalled();
  });

  it('restores a minimized window before showing it', () => {
    const app = lockableApp(true);
    const window = fakeWindow({ isMinimized: vi.fn(() => true) });
    claimSingleInstanceLock(app, { getMainWindow: () => window });
    app.emit('second-instance');
    expect(window.restore).toHaveBeenCalled();
    expect(window.show).toHaveBeenCalled();
  });

  // The window is created on a timer after ready, so a second launch can land
  // before it exists; and it may already be gone during shutdown.
  it('tolerates a missing or destroyed window', () => {
    const noWindow = lockableApp(true);
    claimSingleInstanceLock(noWindow, { getMainWindow: () => null });
    expect(() => noWindow.emit('second-instance')).not.toThrow();

    const destroyed = lockableApp(true);
    const window = fakeWindow({ isDestroyed: vi.fn(() => true) });
    claimSingleInstanceLock(destroyed, { getMainWindow: () => window });
    destroyed.emit('second-instance');
    expect(window.show).not.toHaveBeenCalled();
  });

  it('tolerates being called without options at all', () => {
    const app = lockableApp(true);
    claimSingleInstanceLock(app);
    expect(() => app.emit('second-instance')).not.toThrow();
  });
});

describe('hiddenTitleBarOptions', () => {
  it('hides the native bar and paints the controls cluster in the day palette', async () => {
    const { hiddenTitleBarOptions } = await import('../src/index.js');
    const opts = hiddenTitleBarOptions();
    expect(opts.titleBarStyle).toBe('hidden');
    expect(opts.titleBarOverlay).toEqual({ color: '#081425', symbolColor: '#d8e3fb', height: 32 });
    // The traffic lights sit inside the same 32px strip the renderer reserves.
    expect(opts.trafficLightPosition.y + 12).toBeLessThanOrEqual(32);
  });
});

describe('setupTitleBarOverlay', () => {
  function fakeIpcMainOn() {
    const listeners = new Map();
    return {
      on: vi.fn((channel, fn) => listeners.set(channel, fn)),
      emit: (channel, ...args) => listeners.get(channel)({}, ...args)
    };
  }

  it('repaints the overlay for night and day on the shell:night-mode channel', async () => {
    const { setupTitleBarOverlay } = await import('../src/index.js');
    const ipcMain = fakeIpcMainOn();
    const window = { isDestroyed: () => false, setTitleBarOverlay: vi.fn() };
    setupTitleBarOverlay({ ipcMain, getMainWindow: () => window });

    ipcMain.emit('shell:night-mode', true);
    expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: '#090202', symbolColor: '#ff9e9e', height: 32 });

    ipcMain.emit('shell:night-mode', false);
    expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: '#081425', symbolColor: '#d8e3fb', height: 32 });
  });

  it('does nothing without a window, or where the platform paints no overlay', async () => {
    const { setupTitleBarOverlay } = await import('../src/index.js');
    const ipcMain = fakeIpcMainOn();
    let window = null;
    setupTitleBarOverlay({ ipcMain, getMainWindow: () => window });
    expect(() => ipcMain.emit('shell:night-mode', true)).not.toThrow();

    window = { isDestroyed: () => false }; // macOS: no setTitleBarOverlay
    expect(() => ipcMain.emit('shell:night-mode', true)).not.toThrow();
  });
});
