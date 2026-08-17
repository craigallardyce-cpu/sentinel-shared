import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyLinuxGpuCompatibility, setupAutoUpdater } from '../src/index.js';

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
  });
});
