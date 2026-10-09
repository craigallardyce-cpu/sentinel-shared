import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installWindowGuards } from '../src/index.js';

function fakeWindow() {
  const listeners = new Map();
  let openHandler = null;
  return {
    webContents: {
      setWindowOpenHandler: vi.fn((fn) => { openHandler = fn; }),
      on: vi.fn((event, fn) => listeners.set(event, fn))
    },
    open: (url) => openHandler({ url }),
    navigate(url) {
      const event = { url, preventDefault: vi.fn() };
      listeners.get('will-navigate')(event, url);
      return event;
    }
  };
}

describe('installWindowGuards', () => {
  let win, shell, warn;

  beforeEach(() => {
    win = fakeWindow();
    shell = { openExternal: vi.fn(async () => {}) };
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installWindowGuards(win, { appUrl: 'http://localhost:3000', shell });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows a new window on the app origin, and opens nothing externally', () => {
    expect(win.open('http://localhost:3000/print?x=1')).toEqual({ action: 'allow' });
    expect(win.open('HTTP://LOCALHOST:3000')).toEqual({ action: 'allow' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('denies look-alike origins that a prefix check let through, and sends them to the browser', () => {
    for (const url of ['http://localhost:3000@evil.example/', 'http://localhost:30001', 'http://localhost.evil.com:3000/',
      'https://localhost:3000/']) {
      expect(win.open(url)).toEqual({ action: 'deny' });
      expect(shell.openExternal).toHaveBeenLastCalledWith(url);
    }
    expect(shell.openExternal).toHaveBeenCalledTimes(4);
  });

  it('denies a URL that does not parse, such as http://localhost:3000.evil.com, and opens nothing', () => {
    // The WHATWG parser rejects "3000.evil.com" as a port, so this cannot reach
    // the app origin; it is denied and not handed to the system either.
    expect(win.open('http://localhost:3000.evil.com')).toEqual({ action: 'deny' });
    expect(win.open('')).toEqual({ action: 'deny' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('opens ordinary web links and mailto: externally', () => {
    expect(win.open('https://www.weather.gov/')).toEqual({ action: 'deny' });
    expect(win.open('mailto:support@marinersentinel.com')).toEqual({ action: 'deny' });
    expect(shell.openExternal.mock.calls.map((c) => c[0])).toEqual([
      'https://www.weather.gov/', 'mailto:support@marinersentinel.com'
    ]);
  });

  it('denies file:, ms-settings: and other schemes without opening them, logging the scheme only', () => {
    for (const url of ['file:///C:/x', 'ms-settings:', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(win.open(url)).toEqual({ action: 'deny' });
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('file:');
    expect(logged).toContain('ms-settings:');
    expect(logged).not.toContain('C:/x');
    expect(logged).not.toContain('alert(1)');
  });

  it('lets the main window navigate within the app', () => {
    const event = win.navigate('http://localhost:3000/settings');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('stops the main window leaving the app, and opens the target externally', () => {
    const event = win.navigate('https://evil.example/');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(shell.openExternal).toHaveBeenCalledWith('https://evil.example/');
  });

  it('stops a navigation to a non-web scheme without opening it', () => {
    for (const url of ['file:///C:/x', 'ms-settings:', 'not a url']) {
      expect(win.navigate(url).preventDefault).toHaveBeenCalledOnce();
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('leaves data: navigations alone (the busy-port pages)', () => {
    const event = win.navigate('data:text/html;charset=utf-8,%3Cp%3EStarting%3C%2Fp%3E');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('reads the URL from the second argument when the event does not carry it', () => {
    let handler;
    const old = { webContents: { setWindowOpenHandler: () => {}, on: (e, fn) => { handler = fn; } } };
    installWindowGuards(old, { appUrl: 'http://localhost:3000', shell });
    const event = { preventDefault: vi.fn() };
    handler(event, 'https://evil.example/');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('honours a narrower externalSchemes list', () => {
    const w = fakeWindow();
    installWindowGuards(w, { appUrl: 'http://localhost:3001/', externalSchemes: ['https:'], shell });
    expect(w.open('mailto:a@b.example')).toEqual({ action: 'deny' });
    expect(w.open('http://example.com/')).toEqual({ action: 'deny' });
    expect(shell.openExternal).not.toHaveBeenCalled();
    w.open('https://example.com/');
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('does not throw when the system refuses to open a link', async () => {
    shell.openExternal.mockRejectedValueOnce(new Error('no handler'));
    expect(win.open('https://example.com/')).toEqual({ action: 'deny' });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
  });

  it('refuses an appUrl without an origin', () => {
    expect(() => installWindowGuards(fakeWindow(), { appUrl: 'not a url', shell })).toThrow(TypeError);
    expect(() => installWindowGuards(fakeWindow(), { appUrl: 'data:text/html,x', shell })).toThrow(TypeError);
    expect(() => installWindowGuards(fakeWindow(), { shell })).toThrow(TypeError);
  });
});
