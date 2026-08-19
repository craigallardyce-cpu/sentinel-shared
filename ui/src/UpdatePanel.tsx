import React from 'react';
import { ArrowUpCircle, CheckCircle2, OctagonAlert, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { StatusPill } from './StatusPill';
import type { AppUpdater } from './useAppUpdater';

export interface UpdatePanelProps {
  updater: AppUpdater;
  className?: string;
}

/**
 * The one updater UI: version line, a Check button, and the available /
 * downloading / ready / error states. Plain copy — "Downloading update…", not
 * "EXTRACTING & COMPILING…".
 */
export function UpdatePanel({ updater, className }: UpdatePanelProps) {
  const { state, check, install, isElectron } = updater;
  const busy = state.status === 'checking' || state.status === 'updating';

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text-primary">
            Version <span className="font-mono">{state.currentVersion || '—'}</span>
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {state.status === 'idle' && 'Check for a newer release.'}
            {state.status === 'checking' && 'Checking…'}
            {state.status === 'uptodate' && 'Up to date.'}
            {state.status === 'available' && !state.updateReady && `Version ${state.latestVersion} is available.`}
            {state.status === 'available' && state.updateReady && `Version ${state.latestVersion} is downloaded and ready.`}
            {state.status === 'updating' && (state.updateReady ? 'Restarting…' : 'Downloading update…')}
            {state.status === 'error' && (state.errorMsg || 'Something went wrong.')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state.status === 'uptodate' && <StatusPill status="ok">Current</StatusPill>}
          {state.status === 'error' && <StatusPill status="alarm">Error</StatusPill>}
          {state.status === 'available' ? (
            <Button variant="primary" size="sm" icon={<ArrowUpCircle size={14} />} onClick={install} disabled={!isElectron && !state.updateReady}>
              {state.updateReady ? 'Restart and install' : 'Install update'}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />} onClick={check} loading={state.status === 'checking'}>
              Check for updates
            </Button>
          )}
        </div>
      </div>

      {state.status === 'updating' && (
        <div className="mt-3 h-1.5 w-full rounded-full bg-bg-lowest overflow-hidden">
          <div className="h-full bg-cyan transition-[width] duration-300" style={{ width: `${state.progress || 0}%` }} />
        </div>
      )}

      {state.status === 'available' && state.changelog && (
        <p className="mt-3 text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{state.changelog}</p>
      )}

      {!isElectron && state.status === 'available' && (
        <p className="mt-2 text-xs text-text-muted flex items-center gap-1.5">
          <OctagonAlert size={12} aria-hidden /> Install from the desktop app or your app store.
        </p>
      )}
      {isElectron && state.status === 'uptodate' && (
        <p className="sr-only">
          <CheckCircle2 size={12} aria-hidden /> Up to date
        </p>
      )}
    </div>
  );
}
