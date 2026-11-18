import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { cn } from './cn';
import { HeaderStatusContext } from './StatusPill';
const HEADER_FITS = ['full', 'icons', 'tight'];
const HeaderFitContext = React.createContext('full');
/** The header's current fit, for an app's own `headerActions` items. `full` outside a header. */
export function useHeaderFit() {
    return useContext(HeaderFitContext);
}
/**
 * The room a status band keeps when the header is squeezed: its own 8px sides
 * and a StatusPill standing as its dot (the pill's 32px floor). The status
 * band gives way before the controls do, but not to nothing --
 * HarborSentinel's Instruments dot is the connection state and has to show.
 * At 736px with 100% text that is what tips HarborSentinel's watch header into
 * icons: the words fitted only by cutting the dot off.
 */
export const HEADER_STATUS_FLOOR_PX = 48;
/**
 * The icon-or-word pair every header control draws (HeaderButton's own
 * content), for an app's header item that is not a HeaderButton, such as
 * OceanSentinel's "Muted". Follows the header's fit: the word from `sm` up
 * while it fits, the icon otherwise, with the word kept for screen readers.
 */
export function HeaderLabel({ icon, label }) {
    const fit = useHeaderFit();
    const words = Boolean(label) && fit === 'full';
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: cn('shrink-0 [&>svg]:w-5 [&>svg]:h-5', words ? 'sm:hidden' : undefined), "aria-hidden": true, children: icon }), label && _jsx("span", { className: words ? 'hidden sm:inline' : 'sr-only', children: label })] }));
}
/**
 * A header control (Night, Settings, Guide, End watch…): Inter 15/600 in
 * sentence case, 48px tall.
 *
 * An icon or a word, never both: the word from `sm` up, where there is usually
 * room for it, and the icon below, where there is not (fit-and-finish, "Icons":
 * icon and word together belong only to primary navigation). It was mono,
 * letter-spaced and always iconned, which put a third typeface in every header
 * (X1). When the words do not fit even from `sm` up (large system text on a
 * portrait tablet), AppShell switches every header button to its icon; see
 * `HeaderFit`.
 */
export function HeaderButton({ icon, active = false, label, className, ...rest }) {
    const fit = useHeaderFit();
    return (_jsx("button", { type: "button", className: cn('inline-flex items-center justify-center gap-2 h-12 min-w-12 px-3 rounded-md cursor-pointer', fit === 'full' && 'sm:px-4', 'font-sans text-[15px] font-semibold whitespace-nowrap', 'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60', active ? 'text-cyan' : 'text-text-secondary hover:text-text-primary hover:bg-bg-card-hover', className), "aria-pressed": active, ...rest, children: _jsx(HeaderLabel, { icon: icon, label: label }) }));
}
/**
 * Chooses the header's fit from what its pinned bands need.
 *
 * The brand and the controls are `shrink-0`; the centre and status bands are
 * `min-w-0` and take whatever is left. So the width the pinned bands and the
 * gaps need is the header's inner width, plus whatever spills past its right
 * edge, minus what the two shrinkable bands currently hold -- exact whether it
 * fits or not, with no gap or padding hard-coded. It steps down a fit when that
 * (plus the status floor) is more than the header has, and back up once the
 * header is as wide as the fit above it needed when it was left.
 *
 * A change in what the controls say (End watch appearing, Muted going) clears
 * the remembered widths, so a fit above is tried again; the layout effect then
 * re-measures before the browser paints, so a trial that does not fit is never
 * seen.
 */
function useHeaderFitMeasure(hasStatus) {
    const headerRef = useRef(null);
    const centerRef = useRef(null);
    const statusRef = useRef(null);
    const controlsRef = useRef(null);
    const [fit, setFit] = useState('full');
    const fitRef = useRef('full');
    /* The width each fit needed when the header stepped down from it. */
    const neededAt = useRef({});
    const signature = useRef('');
    const measure = useCallback(() => {
        const header = headerRef.current;
        const controls = controlsRef.current;
        if (!header || !controls)
            return;
        const style = getComputedStyle(header);
        const padL = parseFloat(style.paddingLeft) || 0;
        const padR = parseFloat(style.paddingRight) || 0;
        const inner = header.clientWidth - padL - padR;
        if (inner <= 0)
            return; // not laid out (jsdom, a hidden window)
        /* A step already asked for and not drawn yet: what is on screen is the
           old fit, and measuring it again would step twice for one squeeze. */
        if (header.dataset.fit !== fitRef.current)
            return;
        const text = `${controls.childElementCount}:${controls.textContent ?? ''}`;
        if (text !== signature.current) {
            signature.current = text;
            neededAt.current = {};
        }
        const headerBox = header.getBoundingClientRect();
        const contentRight = headerBox.left + header.clientLeft + header.clientWidth - padR;
        const spill = Math.max(0, controls.getBoundingClientRect().right - contentRight);
        const shrinkable = (centerRef.current?.getBoundingClientRect().width ?? 0) +
            (statusRef.current?.getBoundingClientRect().width ?? 0);
        const needed = inner + spill - shrinkable + (hasStatus ? HEADER_STATUS_FLOOR_PX : 0);
        const current = fitRef.current;
        const index = HEADER_FITS.indexOf(current);
        let next = current;
        if (needed > inner + 0.5) {
            if (index < HEADER_FITS.length - 1) {
                neededAt.current[current] = needed;
                next = HEADER_FITS[index + 1];
            }
        }
        else if (index > 0) {
            const above = HEADER_FITS[index - 1];
            const wanted = neededAt.current[above];
            if (wanted === undefined || inner + 0.5 >= wanted)
                next = above;
        }
        if (next !== current) {
            fitRef.current = next;
            setFit(next);
        }
    }, [hasStatus]);
    /* Every render: what the header holds may have changed. Cheap, and it runs
       before paint, so a step up that does not fit is undone unseen. */
    useLayoutEffect(() => {
        measure();
    });
    useEffect(() => {
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(() => measure());
        [headerRef.current, controlsRef.current].forEach((el) => el && observer.observe(el));
        return () => observer.disconnect();
    }, [measure]);
    return { fit, headerRef, centerRef, statusRef, controlsRef };
}
/* Bottom padding of the content area, as a variable the inline style reads.
   The value differs either side of `lg` (the tab bar shows only below it), and
   an inline style cannot hold a breakpoint -- while theme/shell.css's own
   padding is unlayered, so no utility class could override it. Literal strings,
   so each app's Tailwind finds them when it scans this package. */
const CONTENT_PB = {
    chartTabs: '[--sentinel-shell-pb:calc(var(--shell-bottom-nav)_+_0.5rem_+_var(--safe-area-bottom,0px))] lg:[--sentinel-shell-pb:calc(1rem_+_var(--safe-area-bottom,0px))]',
    chartNoTabs: '[--sentinel-shell-pb:calc(1rem_+_var(--safe-area-bottom,0px))]',
    pageTabs: '[--sentinel-shell-pb:calc(var(--shell-bottom-nav)_+_var(--safe-area-bottom,0px))] lg:[--sentinel-shell-pb:var(--safe-area-bottom,0px)]',
    pageNoTabs: '[--sentinel-shell-pb:var(--safe-area-bottom,0px)]',
    /* nav="bottom": the tab bar shows at every size, so the below-lg value holds
       at every size too. */
    chartTabsBottom: '[--sentinel-shell-pb:calc(var(--shell-bottom-nav)_+_0.5rem_+_var(--safe-area-bottom,0px))]',
    pageTabsBottom: '[--sentinel-shell-pb:calc(var(--shell-bottom-nav)_+_var(--safe-area-bottom,0px))]',
};
/** The one hairline a page draws between the window's chrome and its content. */
const PAGE_HAIRLINE = 'border-bg-highest';
/**
 * The fleet application frame: a 56px header, a 72px rail from `lg` (1024px)
 * up, a tab bar below it, safe-area aware on every edge. The rail breakpoint is
 * deliberately `lg`, not `2xl` — tablets are the likeliest plotter form factor
 * and should get the desktop layout.
 *
 * How the frame is drawn depends on `surface`: floating glass over a chart,
 * opaque and attached for a page.
 */
export function AppShell({ appName, brandIcon, tabs, activeTab, onTabChange, nightMode = false, onToggleNightMode, brightness, settingsOpen = false, onOpenSettings, headerCenter, headerStatus, headerActions, background, passThrough = false, mainClassName, bareMain = false, surface, tabLabelPx = 13, nav = 'responsive', children, className, }) {
    const hasTabs = tabs.length > 0;
    /* nav="bottom": no rail at any size, and the tab bar never hides. */
    const bottomOnly = nav === 'bottom';
    const activeSurface = tabs.find((t) => t.id === activeTab)?.surface;
    const resolved = activeSurface ?? surface ?? (background ? 'chart' : 'page');
    const chart = resolved === 'chart';
    // Night mode and brightness go on <html>, not this div, so portalled dialogs and
    // toasts (rendered into document.body) are themed and dimmed too. On desktop
    // the OS window-controls cluster (electron-shell's hidden title bar) is told as
    // well, so it turns red with the rest of the screen.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('theme-night', !!nightMode);
        root.style.filter = brightness !== undefined && brightness !== 100 ? `brightness(${brightness}%)` : '';
        window.appShell?.setNightMode?.(!!nightMode);
        return () => {
            root.classList.remove('theme-night');
            root.style.filter = '';
            window.appShell?.setNightMode?.(false);
        };
    }, [nightMode, brightness]);
    /* theme/shell.css lays the content out from three variables. Set here, on the
       same element, an inline value beats its class and media rules, so the
       shell's geometry lives in one place:
         chart  16px from every edge (clear of the OS window controls), 16px
                between the header and what is under it;
         page   flush with the window, directly under the title-bar strip.
       The tab bar is 72px in both. */
    const shellVars = {
        '--shell-edge': chart ? 'max(1rem, calc(env(titlebar-area-height, 0px) + 0.5rem))' : 'env(titlebar-area-height, 0px)',
        '--shell-gap': chart ? '1rem' : '0px',
        '--shell-bottom-nav': '4.5rem',
    };
    const sideInset = chart ? '1rem' : '0px';
    const { fit, headerRef, centerRef, statusRef, controlsRef } = useHeaderFitMeasure(Boolean(headerStatus));
    return (_jsx("div", { className: cn('sentinel-shell flex flex-col h-dvh w-screen bg-bg-app text-text-primary overflow-hidden font-sans', className), style: shellVars, "data-surface": resolved, children: _jsxs("div", { className: "flex-grow flex flex-col min-h-0 overflow-hidden relative", children: [background && _jsx("div", { className: "absolute inset-0 z-0", children: background }), _jsxs("header", { ref: headerRef, "data-fit": fit, className: cn('sentinel-header fixed h-14 flex items-center gap-1 z-50 select-none pr-2', chart
                        ? 'left-4 right-4 rounded-xl glass-panel pl-4 sm:pl-5'
                        : cn('left-0 right-0 bg-bg-app border-b pl-4 sm:pl-6', PAGE_HAIRLINE)), style: {
                        top: 'calc(var(--shell-edge) + var(--safe-area-top, 0px))',
                        marginLeft: 'var(--safe-area-left, 0px)',
                        marginRight: 'var(--safe-area-right, 0px)',
                    }, children: [_jsxs("div", { className: "flex items-center gap-2.5 shrink-0 min-w-0", children: [brandIcon && _jsx("span", { className: "text-cyan shrink-0 [&>svg]:w-5 [&>svg]:h-5", "aria-hidden": true, children: brandIcon }), _jsx("span", { className: cn('hidden font-wordmark font-semibold text-[17px] text-cyan truncate', fit !== 'tight' && 'sm:inline'), "data-slot": "wordmark", children: appName })] }), _jsx("div", { ref: centerRef, className: "flex-auto min-w-0 flex items-center justify-center overflow-hidden", children: headerCenter }), _jsxs("div", { className: "flex items-center gap-2 sm:gap-3 min-w-0", children: [headerStatus && (_jsx("div", { ref: statusRef, className: "flex items-center gap-4 min-w-0 overflow-hidden sm:px-2", "data-slot": "header-status", children: _jsx(HeaderStatusContext.Provider, { value: true, children: headerStatus }) })), _jsx("div", { ref: controlsRef, className: "flex items-center gap-1 shrink-0", "data-slot": "header-controls", children: _jsxs(HeaderFitContext.Provider, { value: fit, children: [onToggleNightMode && (_jsx(HeaderButton, { icon: nightMode ? _jsx(Sun, { size: 20 }) : _jsx(Moon, { size: 20 }), active: nightMode, label: nightMode ? 'Day' : 'Night', onClick: onToggleNightMode, "aria-label": nightMode ? 'Switch to day mode' : 'Switch to night mode' })), onOpenSettings && (_jsx(HeaderButton, { icon: _jsx(Settings, { size: 20 }), active: settingsOpen, label: "Settings", onClick: onOpenSettings, "aria-label": "Settings" })), headerActions] }) })] })] }), _jsxs("div", { className: cn('sentinel-shell-content flex-grow flex flex-row min-h-0 overflow-hidden relative z-10', chart ? 'gap-4' : 'gap-0', !hasTabs && 'sentinel-shell-content--no-tabs', hasTabs
                        ? bottomOnly
                            ? chart ? CONTENT_PB.chartTabsBottom : CONTENT_PB.pageTabsBottom
                            : chart ? CONTENT_PB.chartTabs : CONTENT_PB.pageTabs
                        : chart ? CONTENT_PB.chartNoTabs : CONTENT_PB.pageNoTabs, passThrough && 'pointer-events-none'), style: {
                        paddingLeft: `calc(${sideInset} + var(--safe-area-left, 0px))`,
                        paddingRight: `calc(${sideInset} + var(--safe-area-right, 0px))`,
                        paddingBottom: 'var(--sentinel-shell-pb)',
                    }, children: [hasTabs && !bottomOnly && (_jsx("aside", { className: cn('hidden lg:flex flex-col shrink-0 w-18 h-full p-2 select-none pointer-events-auto', chart ? 'glass-panel rounded-xl' : cn('bg-bg-app border-r', PAGE_HAIRLINE)), children: _jsx("nav", { className: "flex flex-col gap-1 w-full", "aria-label": "Primary", children: tabs.map((tab) => {
                                    const active = tab.id === activeTab;
                                    return (_jsxs("button", { type: "button", onClick: () => onTabChange(tab.id), "aria-current": active ? 'page' : undefined, title: typeof tab.label === 'string' ? tab.label : undefined, className: cn('relative flex flex-col items-center justify-center gap-1 min-h-16 w-full px-0.5 py-2 rounded-md cursor-pointer text-center', 'font-sans text-[13px] font-semibold leading-4', 'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60', active ? 'bg-cyan-dim text-cyan' : 'text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'), children: [_jsx("span", { className: "shrink-0 [&>svg]:w-5 [&>svg]:h-5", "aria-hidden": true, children: tab.icon }), _jsx("span", { className: "max-w-full hyphens-manual [overflow-wrap:normal]", "data-slot": "rail-label", children: tab.label }), tab.badge !== undefined && tab.badge > 0 && (_jsx("span", { className: "absolute top-1 right-1 bg-warning text-bg-app text-[13px] font-mono font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center", children: tab.badge }))] }, tab.id));
                                }) }) })), _jsx("main", { className: cn('flex-1 flex flex-col min-h-0 min-w-0 relative', !bareMain &&
                                (chart
                                    ? 'glass-panel rounded-xl p-4 sm:p-5 overflow-y-auto custom-scrollbar'
                                    : 'bg-bg-app p-4 sm:p-6 overflow-y-auto custom-scrollbar'), mainClassName), children: children })] }), hasTabs && (_jsx("nav", { className: cn('fixed bottom-0 left-0 right-0 grid grid-flow-col auto-cols-fr z-40 select-none px-1 border-t', !bottomOnly && 'lg:hidden', chart ? 'bg-bg-panel/90 backdrop-blur-md border-border-color' : cn('bg-bg-app', PAGE_HAIRLINE)), style: { height: 'calc(var(--shell-bottom-nav) + var(--safe-area-bottom, 0px))', paddingBottom: 'var(--safe-area-bottom, 0px)' }, "aria-label": "Primary", children: tabs.map((tab) => {
                        const active = tab.id === activeTab;
                        return (_jsxs("button", { type: "button", onClick: () => onTabChange(tab.id), "aria-current": active ? 'page' : undefined, className: cn('relative flex flex-col items-center justify-center gap-1 min-w-0 px-0.5 cursor-pointer text-center', 'font-sans font-semibold leading-tight', 
                            // VesselKeeper's approved exception is 12px below `sm` only, and
                            // the drift checker recognises it only written this way.
                            tabLabelPx === 12 ? 'text-[12px] sm:text-[13px]' : 'text-[13px]', 'transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan/60', active ? 'text-cyan' : 'text-text-secondary hover:text-text-primary'), children: [_jsx("span", { className: "shrink-0 [&>svg]:w-5 [&>svg]:h-5", "aria-hidden": true, children: tab.icon }), _jsx("span", { className: "max-w-full whitespace-nowrap overflow-hidden text-ellipsis", "data-slot": "tab-label", children: tab.label }), tab.badge !== undefined && tab.badge > 0 && (_jsx("span", { className: "absolute top-1 right-1 bg-warning text-bg-app text-[13px] font-mono font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center", children: tab.badge }))] }, tab.id));
                    }) }))] }) }));
}
