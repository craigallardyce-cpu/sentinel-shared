import React, { useEffect, useMemo, useState } from 'react';

/**
 * The file each app's build writes beside its index.html, with every
 * open-source package the app ships and the licence text it came with
 * (`sentinel-shared/scripts/generate-licences.mjs`). Fetched relative to the
 * page, so it resolves the same under Electron's local server, Android's
 * WebView and a browser on the boat's network.
 */
export const LICENCES_FILE = 'third-party-licenses.json';

/** One package as the generator writes it. */
export interface LicencedPackage {
  name: string;
  version: string;
  /** The SPDX expression from the package's own package.json, or "UNKNOWN". */
  license: string;
  /** Index into `texts`, or -1 when the package ships no licence file. */
  text: number;
}

/** The whole file. Identical licence texts are stored once and shared. */
export interface LicenceFile {
  generatedAt: string;
  packages: LicencedPackage[];
  texts: string[];
}

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'failed' } | { state: 'ready'; file: LicenceFile };

/** Whether a parsed file has the shape the generator writes. */
export function isLicenceFile(value: unknown): value is LicenceFile {
  const v = value as LicenceFile;
  return !!v && Array.isArray(v.packages) && Array.isArray(v.texts);
}

/**
 * "Open-source licences" in the About card: Terms of Service §5 says the apps
 * list their open-source components' licences, and MIT, BSD and Apache
 * require their notices to ship with the software that uses them.
 *
 * Inline rather than its own dialog. About already sits inside the Settings
 * dialog, and the fleet Modal closes on Escape from a document listener, so a
 * second Modal on top of it would close both at once.
 */
export function OpenSourceLicences({ appName }: { appName: string }) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [filter, setFilter] = useState('');

  // Loaded once, the first time the list is opened. Not cancelled on close:
  // the file is small and local, and keeping it means reopening is instant.
  useEffect(() => {
    if (!open || load.state !== 'idle') return;
    setLoad({ state: 'loading' });
    fetch(LICENCES_FILE, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => setLoad(isLicenceFile(json) ? { state: 'ready', file: json } : { state: 'failed' }))
      .catch(() => setLoad({ state: 'failed' }));
  }, [open, load.state]);

  const shown = useMemo(() => {
    if (load.state !== 'ready') return [];
    const q = filter.trim().toLowerCase();
    return q
      ? load.file.packages.filter((p) => p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q))
      : load.file.packages;
  }, [load, filter]);

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-cyan hover:underline"
      >
        {open ? 'Hide open-source licences' : 'Open-source licences'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {load.state === 'loading' && <p className="text-text-muted">Loading…</p>}
          {load.state === 'failed' && (
            <p className="text-text-muted">The licence list is not included in this build.</p>
          )}
          {load.state === 'ready' && (
            <>
              <p className="text-text-muted">
                {appName} is built with {load.file.packages.length} open-source components. Each is used under its own
                licence, which is shown in full beside it.
              </p>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name or licence"
                aria-label="Filter open-source licences"
                className="w-full rounded-md border border-border-color bg-bg-panel px-3 py-1.5 text-text-primary focus:border-cyan focus:outline-none"
              />
              <ul className="max-h-80 overflow-y-auto rounded-md border border-border-color" aria-label="Open-source components">
                {shown.map((p) => (
                  <li key={`${p.name}@${p.version}`} className="border-b border-border-color last:border-b-0">
                    <details>
                      <summary className="cursor-pointer px-3 py-1.5">
                        <span className="text-text-primary">{p.name}</span>{' '}
                        <span className="font-mono text-text-muted">{p.version}</span>{' '}
                        <span className="text-text-muted">· {p.license}</span>
                      </summary>
                      <pre className="whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[13px] text-text-secondary">
                        {p.text >= 0 ? load.file.texts[p.text] : `No licence file is included with this package. Its stated licence is ${p.license}.`}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
