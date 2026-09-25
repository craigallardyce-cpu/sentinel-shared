import { describe, it, expect, vi, afterEach } from 'vitest';
import { openExternal, isWebUrl } from '../src/openExternal';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openExternal', () => {
  it('opens an https URL in a new window with no opener and no referrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('https://marinersentinel.com/account')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://marinersentinel.com/account', '_blank', 'noopener,noreferrer');
  });

  it('opens http too', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('http://example.com/')).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  /*
    `true` although window.open returned null: with `noopener` the spec has it
    return null on success, and Electron's handler denies the window after
    handing the URL to the system browser. Treating null as failure would
    report every successful open in the fleet as a failure.
  */
  it('reports success when the platform hands back no window, as noopener and Electron both do', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('https://example.com')).toBe(true);
  });

  it('reports failure when window.open throws', () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(openExternal('https://example.com')).toBe(false);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:support@marinersentinel.com',
    'capacitor://localhost/index.html',
    'ms-settings:privacy',
    '/account',
    'marinersentinel.com',
    '',
    '   ',
  ])('refuses %j without calling window.open', (url) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal(url)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a non-string from an untyped caller', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal(undefined as unknown as string)).toBe(false);
    expect(openExternal(null as unknown as string)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace before opening', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('  https://example.com/x  ')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
  });
});

describe('isWebUrl', () => {
  it('accepts absolute http(s) only', () => {
    expect(isWebUrl('https://a.b')).toBe(true);
    expect(isWebUrl('HTTPS://A.B/path?q=1')).toBe(true);
    expect(isWebUrl('ftp://a.b')).toBe(false);
    expect(isWebUrl('//a.b')).toBe(false);
    expect(isWebUrl(42)).toBe(false);
  });
});
