import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
/**
 * The file each app's build writes beside its index.html, with every
 * open-source package the app ships and the licence text it came with
 * (`sentinel-shared/scripts/generate-licences.mjs`). Fetched relative to the
 * page, so it resolves the same under Electron's local server, Android's
 * WebView and a browser on the boat's network.
 */
export const LICENCES_FILE = 'third-party-licenses.json';
/** Whether a parsed file has the shape the generator writes. */
export function isLicenceFile(value) {
    const v = value;
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
export function OpenSourceLicences({ appName }) {
    const [open, setOpen] = useState(false);
    const [load, setLoad] = useState({ state: 'idle' });
    const [filter, setFilter] = useState('');
    // Loaded once, the first time the list is opened. Not cancelled on close:
    // the file is small and local, and keeping it means reopening is instant.
    useEffect(() => {
        if (!open || load.state !== 'idle')
            return;
        setLoad({ state: 'loading' });
        fetch(LICENCES_FILE, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((json) => setLoad(isLicenceFile(json) ? { state: 'ready', file: json } : { state: 'failed' }))
            .catch(() => setLoad({ state: 'failed' }));
    }, [open, load.state]);
    const shown = useMemo(() => {
        if (load.state !== 'ready')
            return [];
        const q = filter.trim().toLowerCase();
        return q
            ? load.file.packages.filter((p) => p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q))
            : load.file.packages;
    }, [load, filter]);
    return (_jsxs("div", { className: "mt-2", children: [_jsx("button", { type: "button", "aria-expanded": open, onClick: () => setOpen((v) => !v), className: "text-cyan hover:underline", children: open ? 'Hide open-source licences' : 'Open-source licences' }), open && (_jsxs("div", { className: "mt-2 space-y-2", children: [load.state === 'loading' && _jsx("p", { className: "text-text-muted", children: "Loading\u2026" }), load.state === 'failed' && (_jsx("p", { className: "text-text-muted", children: "The licence list is not included in this build." })), load.state === 'ready' && (_jsxs(_Fragment, { children: [_jsxs("p", { className: "text-text-muted", children: [appName, " is built with ", load.file.packages.length, " open-source components. Each is used under its own licence, which is shown in full beside it."] }), _jsx("input", { type: "search", value: filter, onChange: (e) => setFilter(e.target.value), placeholder: "Filter by name or licence", "aria-label": "Filter open-source licences", className: "w-full rounded-md border border-border-color bg-bg-panel px-3 py-1.5 text-text-primary focus:border-cyan focus:outline-none" }), _jsx("ul", { className: "max-h-80 overflow-y-auto rounded-md border border-border-color", "aria-label": "Open-source components", children: shown.map((p) => (_jsx("li", { className: "border-b border-border-color last:border-b-0", children: _jsxs("details", { children: [_jsxs("summary", { className: "cursor-pointer px-3 py-1.5", children: [_jsx("span", { className: "text-text-primary", children: p.name }), ' ', _jsx("span", { className: "font-mono text-text-muted", children: p.version }), ' ', _jsxs("span", { className: "text-text-muted", children: ["\u00B7 ", p.license] })] }), _jsx("pre", { className: "whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[13px] text-text-secondary", children: p.text >= 0 ? load.file.texts[p.text] : `No licence file is included with this package. Its stated licence is ${p.license}.` })] }) }, `${p.name}@${p.version}`))) })] }))] }))] }));
}
