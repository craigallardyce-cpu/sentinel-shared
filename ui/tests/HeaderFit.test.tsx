import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell, HeaderButton, HeaderLabel, useHeaderFit } from '../src/AppShell';

/**
 * The header steps from words to icons, and then drops the wordmark, when its
 * controls do not fit on one line, and steps back once they would (Craig's
 * portrait tablet, 17 Nov 2026: 736px with large system text put the watch
 * state off the right edge).
 *
 * jsdom does no layout, so these tests give the header and its controls the
 * sizes a browser would and re-render; the shell measures in a layout effect on
 * every render. The real layout was measured in headless Chromium at 360 to
 * 1024px with text at 100% and 130%; the pictures are in the pull request.
 */

function box(el: Element, rect: { left?: number; right: number; width?: number }) {
  const left = rect.left ?? 0;
  const width = rect.width ?? rect.right - left;
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left, right: left + width, width, top: 0, bottom: 56, height: 56, x: left, y: 0, toJSON: () => ({}) }),
  });
}

function width(el: Element, w: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: w });
  box(el, { right: w });
}

function Shell({ status }: { status?: boolean }) {
  return (
    <AppShell
      appName="HarborSentinel"
      tabs={[]}
      activeTab=""
      onTabChange={vi.fn()}
      onToggleNightMode={vi.fn()}
      onOpenSettings={vi.fn()}
      headerStatus={status ? <span>Instruments</span> : undefined}
      headerActions={<HeaderButton icon={<svg />} label="End watch" aria-label="End watch" />}
    />
  );
}

/** Lay the header out `headerWidth` wide with controls reaching `controlsRight`. */
function layout(container: HTMLElement, headerWidth: number, controlsRight: number) {
  const header = container.querySelector('header')!;
  width(header, headerWidth);
  box(container.querySelector('[data-slot="header-controls"]')!, { left: 0, right: controlsRight });
  return header;
}

describe('header fit', () => {
  it('draws words from sm up while they fit', () => {
    const { container } = render(<Shell />);
    expect(container.querySelector('header')!.dataset.fit).toBe('full');
    expect(screen.getByText('End watch').className).toBe('hidden sm:inline');
  });

  it('steps to icons, then drops the wordmark, while the controls spill past the edge', () => {
    const { container, rerender } = render(<Shell />);
    const header = layout(container, 500, 600);
    rerender(<Shell />);
    // Still spilling with icons (the stub does not shrink), so it goes on to tight.
    expect(header.dataset.fit).toBe('tight');
    expect(screen.getByText('End watch').className).toBe('sr-only');
    expect(container.querySelector('[data-slot="wordmark"]')!.className.split(/\s+/)).not.toContain('sm:inline');
  });

  it('stops at icons when icons are enough', () => {
    const { container, rerender } = render(<Shell />);
    const header = layout(container, 500, 600);
    // The first measure steps to icons; with icons drawn the controls fit.
    const controls = container.querySelector('[data-slot="header-controls"]')!;
    let calls = 0;
    Object.defineProperty(controls, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        calls += 1;
        const right = header.getAttribute('data-fit') === 'full' ? 600 : 400;
        return { left: 0, right, width: right, top: 0, bottom: 56, height: 56, x: 0, y: 0, toJSON: () => ({}) };
      },
    });
    rerender(<Shell />);
    expect(calls).toBeGreaterThan(0);
    expect(header.getAttribute('data-fit')).toBe('icons');
    expect(container.querySelector('[data-slot="wordmark"]')!.className.split(/\s+/)).toContain('sm:inline');
  });

  it('steps back up once the header is as wide as the words needed', () => {
    const { container, rerender } = render(<Shell />);
    const header = layout(container, 500, 600);
    rerender(<Shell />);
    expect(header.dataset.fit).toBe('tight');
    layout(container, 700, 650);
    rerender(<Shell />);
    expect(header.dataset.fit).toBe('full');
  });

  it('keeps room for a status dot: words that fit only by hiding the status step down', () => {
    const { container, rerender } = render(<Shell status />);
    const header = layout(container, 500, 480);
    box(container.querySelector('[data-slot="header-status"]')!, { left: 0, right: 10 });
    rerender(<Shell status />);
    expect(header.dataset.fit).not.toBe('full');
  });

  it('gives an app item the same icon-or-word rule through HeaderLabel and useHeaderFit', () => {
    function Probe() {
      return <span data-testid="probe">{useHeaderFit()}</span>;
    }
    const { container, rerender } = render(
      <AppShell
        appName="OceanSentinel"
        tabs={[]}
        activeTab=""
        onTabChange={vi.fn()}
        headerActions={<button><HeaderLabel icon={<svg />} label="Muted" /><Probe /></button>}
      />
    );
    expect(screen.getByTestId('probe').textContent).toBe('full');
    expect(screen.getByText('Muted').className).toBe('hidden sm:inline');
    layout(container, 300, 400);
    rerender(
      <AppShell
        appName="OceanSentinel"
        tabs={[]}
        activeTab=""
        onTabChange={vi.fn()}
        headerActions={<button><HeaderLabel icon={<svg />} label="Muted" /><Probe /></button>}
      />
    );
    expect(screen.getByTestId('probe').textContent).not.toBe('full');
    expect(screen.getByText('Muted').className).toBe('sr-only');
  });

  it('reads as full outside a header', () => {
    function Probe() {
      return <span data-testid="probe">{useHeaderFit()}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('full');
  });
});
