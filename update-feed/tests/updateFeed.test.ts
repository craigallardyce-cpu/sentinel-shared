import { describe, expect, it } from 'vitest';
import {
  UPDATE_FEED_BASE,
  appVersionHandler,
  checkLatestRelease,
  compareVersions,
  updateFeedUrl,
} from '../src/index';

/**
 * The update check that told every desktop user "No releases published on
 * GitHub yet" while a release sat there, because the repositories are private
 * and the check was anonymous. Two things made that look healthy: a 404 read as
 * "nothing yet", and `!==` would have called a downgrade an update anyway.
 */

const release = (over: Record<string, unknown> = {}) => ({
  app: 'harborsentinel',
  version: '2.11.2',
  name: 'HarborSentinel 2.11.2',
  notes: ['Anchor alarm is louder', 'Fixes the chart freeze'],
  publishedAt: '2026-09-15T10:00:00Z',
  ...over,
});

const jsonFetch = (body: unknown, status = 200) => {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('the feed address', () => {
  it('is the website, one directory per app, with a trailing slash', () => {
    expect(UPDATE_FEED_BASE).toBe('https://marinersentinel.com/updates');
    expect(updateFeedUrl('harborsentinel')).toBe('https://marinersentinel.com/updates/harborsentinel/');
    expect(updateFeedUrl('vesselkeeper', 'http://localhost:3000/updates/')).toBe('http://localhost:3000/updates/vesselkeeper/');
  });

  it('reads release.json from that directory', async () => {
    const { impl, calls } = jsonFetch(release());
    await checkLatestRelease({ app: 'oceansentinel', currentVersion: '2.11.2', fetchImpl: impl });
    expect(calls).toEqual(['https://marinersentinel.com/updates/oceansentinel/release.json']);
  });
});

describe('version comparison', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('2.11.10', '2.11.9')).toBe(1);
    expect(compareVersions('2.11.9', '2.11.10')).toBe(-1);
  });

  it('ignores a leading v', () => {
    expect(compareVersions('v2.11.2', '2.11.2')).toBe(0);
  });

  it('sorts a prerelease below its release', () => {
    expect(compareVersions('2.12.0-beta.1', '2.12.0')).toBe(-1);
    expect(compareVersions('2.12.0', '2.12.0-beta.1')).toBe(1);
    expect(compareVersions('2.12.0-beta.2', '2.12.0-beta.10')).toBe(-1);
    expect(compareVersions('2.12.0-alpha', '2.12.0-beta')).toBe(-1);
  });

  it('does not offer a downgrade as an update', async () => {
    const { impl } = jsonFetch(release({ version: '2.11.1' }));
    const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: impl });
    expect(r).toMatchObject({ ok: true, latestVersion: '2.11.1', hasUpdate: false });
  });

  it('offers a newer release, and not the one already running', async () => {
    const newer = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.1', fetchImpl: jsonFetch(release()).impl });
    expect(newer).toMatchObject({ ok: true, currentVersion: '2.11.1', latestVersion: '2.11.2', hasUpdate: true });
    const same = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: jsonFetch(release({ version: 'v2.11.2' })).impl });
    expect(same).toMatchObject({ ok: true, latestVersion: '2.11.2', hasUpdate: false });
  });
});

describe('the changelog', () => {
  it('is the notes joined by newlines, as a string for the About panel', async () => {
    const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.1', fetchImpl: jsonFetch(release()).impl });
    expect(r.ok && r.changelog).toBe('Anchor alarm is louder\nFixes the chart freeze');
  });

  it('is empty when the release has no notes', async () => {
    const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.1', fetchImpl: jsonFetch(release({ notes: [] })).impl });
    expect(r.ok && r.changelog).toBe('');
  });
});

describe('failures are failures', () => {
  const unreachable = { ok: false, currentVersion: '2.11.2', error: 'Could not reach the update server.' };

  it('a 404 is an error, never "no releases yet"', async () => {
    const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: jsonFetch({ error: 'Not Found' }, 404).impl });
    expect(r).toEqual(unreachable);
  });

  it('a fetch that throws is an error', async () => {
    const impl = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: impl })).toEqual(unreachable);
  });

  it('a timeout is an error, and aborts the request', async () => {
    let aborted = false;
    const impl = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
      })) as unknown as typeof fetch;
    const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: impl, timeoutMs: 20 });
    expect(r).toEqual(unreachable);
    expect(aborted).toBe(true);
  });

  it('a fetch that ignores its abort signal still times out', async () => {
    const impl = (() => new Promise(() => {})) as unknown as typeof fetch;
    const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: impl, timeoutMs: 20 });
    expect(r).toEqual(unreachable);
  });

  it('a body that is not the feed is an error', async () => {
    for (const body of [null, 'hello', {}, { version: 42 }, { version: 'latest' }, release({ notes: 'one line' })]) {
      const r = await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: jsonFetch(body).impl });
      expect(r).toEqual(unreachable);
    }
    const html = (async () => new Response('<!doctype html>', { status: 200 })) as unknown as typeof fetch;
    expect(await checkLatestRelease({ app: 'harborsentinel', currentVersion: '2.11.2', fetchImpl: html })).toEqual(unreachable);
  });
});

describe('the /app-version handler', () => {
  const fakeRes = () => {
    const out: { status?: number; body?: unknown } = {};
    return {
      out,
      res: { status(n: number) { out.status = n; return { json(b: unknown) { out.body = b; } }; } },
    };
  };

  it('answers 200 with the versions and changelog', async () => {
    const { out, res } = fakeRes();
    await appVersionHandler({ app: 'vesselkeeper', getCurrentVersion: () => '2.11.1', fetchImpl: jsonFetch(release()).impl })({}, res);
    expect(out).toEqual({
      status: 200,
      body: { currentVersion: '2.11.1', latestVersion: '2.11.2', hasUpdate: true, changelog: 'Anchor alarm is louder\nFixes the chart freeze' },
    });
  });

  it('answers 502 with the error when the feed cannot be read', async () => {
    const { out, res } = fakeRes();
    await appVersionHandler({ app: 'vesselkeeper', getCurrentVersion: () => '2.11.2', fetchImpl: jsonFetch({}, 404).impl })({}, res);
    expect(out).toEqual({ status: 502, body: { currentVersion: '2.11.2', error: 'Could not reach the update server.' } });
  });

  it('reads the current version on each request, not once at setup', async () => {
    let v = '2.11.1';
    const handler = appVersionHandler({ app: 'vesselkeeper', getCurrentVersion: () => v, fetchImpl: jsonFetch(release()).impl });
    v = '2.11.2';
    const { out, res } = fakeRes();
    await handler({}, res);
    expect(out.body).toMatchObject({ currentVersion: '2.11.2', hasUpdate: false });
  });
});
