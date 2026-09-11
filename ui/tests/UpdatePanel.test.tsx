import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { UpdatePanel } from '../src/UpdatePanel';
import { canCheckHere, type AppUpdater, type UpdateState } from '../src/useAppUpdater';

/**
 * What the Updates panel offers, and where it must not offer it.
 *
 * Seen on a real handset on 2026-09-07: HarborSentinel 2.10.1, Settings →
 * Updates, "Could not reach the update server." Not a network fault and not an
 * outage — there is no update server for Android and there is not meant to be.
 * All three apps build `versionUrl` from a backend address a standalone phone
 * does not have, so it comes out as a bare path, which inside a Capacitor
 * WebView resolves against the app's own origin where nothing is listening.
 * The check therefore failed every time, by construction, and the failure was
 * dressed as an error the customer might act on.
 *
 * The rule is keyed on the URL rather than the platform alone, so a phone in PC
 * Server mode — which does have a backend and an absolute URL to it — keeps a
 * check that genuinely works. These cases pin both directions.
 */

const RELATIVE = '/api/app-version';
const ABSOLUTE = 'http://192.168.1.40:3001/api/app-version';

describe('canCheckHere', () => {
  it('is true in Electron, which has the real auto-updater', () => {
    // Even with no versionUrl at all: Electron never uses one.
    expect(canCheckHere({ isElectron: true })).toBe(true);
    expect(canCheckHere({ isElectron: true, versionUrl: RELATIVE, native: true })).toBe(true);
  });

  it('is false on a phone with no backend, which is the reported fault', () => {
    expect(canCheckHere({ isElectron: false, versionUrl: RELATIVE, native: true })).toBe(false);
  });

  it('is true on a phone paired to a backend, which has somewhere to ask', () => {
    // PC Server mode. Suppressing on platform alone would have removed a
    // working feature from these installs.
    expect(canCheckHere({ isElectron: false, versionUrl: ABSOLUTE, native: true })).toBe(true);
  });

  it('is true on the web, where a relative URL resolves against the server', () => {
    expect(canCheckHere({ isElectron: false, versionUrl: RELATIVE, native: false })).toBe(true);
  });

  it('is false when no versionUrl was given and there is no updater', () => {
    // Nothing to ask by any route: the panel used to show a Check button that
    // could do nothing at all.
    expect(canCheckHere({ isElectron: false, native: false })).toBe(false);
  });
});

function updaterFor(state: UpdateState, opts: { canCheck: boolean; isElectron?: boolean }): AppUpdater {
  return {
    state,
    isElectron: opts.isElectron ?? false,
    canCheck: opts.canCheck,
    check: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UpdatePanel where a check cannot succeed', () => {
  it('shows the version and offers nothing else', () => {
    render(<UpdatePanel updater={updaterFor({ status: 'idle', currentVersion: '2.11.1' }, { canCheck: false })} />);

    expect(screen.getByText('2.11.1')).toBeInTheDocument();
    // The button is the whole complaint: it invites an action that fails every
    // time it is taken.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Check for a newer release/i)).toBeNull();
  });

  it('shows no error even when the state carries one', () => {
    // A stale error from before the guard, or a stray check() call, must not
    // reach the customer on a device where it can only ever be wrong.
    render(
      <UpdatePanel
        updater={updaterFor(
          { status: 'error', currentVersion: '2.11.1', errorMsg: 'Could not reach the update server.' },
          { canCheck: false }
        )}
      />
    );

    expect(screen.queryByText(/Could not reach the update server/i)).toBeNull();
    expect(screen.queryByText('Error')).toBeNull();
    expect(screen.getByText('2.11.1')).toBeInTheDocument();
  });

  it('still renders a dash when the version is unknown', () => {
    render(<UpdatePanel updater={updaterFor({ status: 'idle' }, { canCheck: false })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('UpdatePanel where a check can succeed', () => {
  it('keeps the Check button, so nothing is lost on desktop', () => {
    render(<UpdatePanel updater={updaterFor({ status: 'idle', currentVersion: '2.11.1' }, { canCheck: true, isElectron: true })} />);

    expect(screen.getByRole('button', { name: /Check for updates/i })).toBeInTheDocument();
    expect(screen.getByText(/Check for a newer release/i)).toBeInTheDocument();
  });

  it('still reports a real error where a check was genuinely possible', () => {
    // A desktop that could not reach its backend has a fault worth reporting.
    // This is the case the suppression must not swallow.
    render(
      <UpdatePanel
        updater={updaterFor(
          { status: 'error', currentVersion: '2.11.1', errorMsg: 'Could not reach the update server.' },
          { canCheck: true, isElectron: true }
        )}
      />
    );

    expect(screen.getByText(/Could not reach the update server/i)).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });
});
