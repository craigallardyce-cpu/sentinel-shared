import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../src/Tabs';
import type { TabItem } from '../src/Tabs';

const ITEMS: TabItem[] = [
  { id: 'scheduled', label: 'Scheduled', count: 12 },
  { id: 'engine', label: 'Engine' },
  { id: 'rigging', label: 'Rigging', count: 0 },
];

function Controlled({ onAdd, initial = 'scheduled' }: { onAdd?: () => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <Tabs items={ITEMS} value={value} onChange={setValue} onAdd={onAdd} aria-label="Maintenance tabs" />;
}

describe('Tabs', () => {
  it('is a tablist of tabs with the selected one marked', () => {
    render(<Controlled />);
    expect(screen.getByRole('tablist', { name: 'Maintenance tabs' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Scheduled/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Engine' })).toHaveAttribute('aria-selected', 'false');
  });

  it('marks the selected tab with the 2px accent stroke, and the rest with none', () => {
    render(<Controlled />);
    const selected = screen.getByRole('tab', { name: /Scheduled/ }).className;
    const other = screen.getByRole('tab', { name: 'Engine' }).className;
    expect(selected).toContain('border-b-2');
    expect(selected).toContain('border-cyan');
    expect(other).toContain('border-transparent');
    for (const cls of [selected, other]) {
      expect(cls).toContain('h-12');
      expect(cls).toContain('text-[15px]');
      expect(cls).toContain('font-semibold');
      expect(cls).not.toMatch(/uppercase|font-mono|tracking-/);
    }
  });

  it('selects a tab on click', () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="scheduled" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Engine' }));
    expect(onChange).toHaveBeenCalledWith('engine');
  });

  it('draws a count as a quiet mono numeral, including zero', () => {
    render(<Controlled />);
    const count = screen.getByRole('tab', { name: /Scheduled/ }).querySelector('[data-slot="count"]')!;
    expect(count.textContent).toBe('12');
    expect(count.className).toContain('font-mono');
    expect(count.className).toContain('text-text-muted');
    expect(count.className).not.toMatch(/rounded|bg-/);
    expect(screen.getByRole('tab', { name: /Rigging/ }).querySelector('[data-slot="count"]')!.textContent).toBe('0');
    expect(screen.getByRole('tab', { name: 'Engine' }).querySelector('[data-slot="count"]')).toBeNull();
  });

  it('is one tab stop: only the selected tab is in the tab order', () => {
    render(<Controlled initial="engine" />);
    expect(screen.getByRole('tab', { name: 'Engine' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Scheduled/ })).toHaveAttribute('tabindex', '-1');
  });

  it('moves and selects with the arrow keys, wrapping at the ends', () => {
    render(<Controlled />);
    const first = screen.getByRole('tab', { name: /Scheduled/ });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const engine = screen.getByRole('tab', { name: 'Engine' });
    expect(engine).toHaveAttribute('aria-selected', 'true');
    expect(engine).toHaveFocus();

    fireEvent.keyDown(engine, { key: 'ArrowLeft' });
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    const last = screen.getByRole('tab', { name: /Rigging/ });
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(first, { key: 'End' });
    expect(last).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it('offers one Add button, named "New tab" by default, when onAdd is set', () => {
    const onAdd = vi.fn();
    render(<Controlled onAdd={onAdd} />);
    const add = screen.getByRole('button', { name: 'New tab' });
    // Outside the tablist: a tablist holds only tabs.
    expect(screen.getByRole('tablist').contains(add)).toBe(false);
    expect(add.className).toContain('h-12');
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('takes its own add label, and has no Add button without onAdd', () => {
    const { unmount } = render(<Tabs items={ITEMS} value="engine" onChange={vi.fn()} onAdd={vi.fn()} addLabel="Add a list" />);
    expect(screen.getByRole('button', { name: 'Add a list' })).toBeInTheDocument();
    unmount();

    render(<Tabs items={ITEMS} value="engine" onChange={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('links tabs to panels when given an id prefix', () => {
    render(<Tabs items={ITEMS} value="engine" onChange={vi.fn()} idPrefix="maint" />);
    const engine = screen.getByRole('tab', { name: 'Engine' });
    expect(engine).toHaveAttribute('id', 'maint-tab-engine');
    expect(engine).toHaveAttribute('aria-controls', 'maint-panel-engine');
  });
});

/*
  Where the strip rests (fit-and-finish fixes, 2026-10-05). On HarborSentinel's
  phone Settings, selecting About left "Display" as a sliver at the left edge.
  The strip now rests only on tab boundaries.
*/
import { tabStripScrollFor } from '../src/Tabs';
import { afterEach, beforeEach } from 'vitest';

describe('tabStripScrollFor', () => {
  // Five tabs, as HarborSentinel's Settings: Display, Vessel, Data, Telegram, About.
  const starts = [0, 110, 200, 290, 410];
  const ends = [110, 200, 290, 410, 500];
  const width = 312;

  it('rests at 0 when the selected tab fits from the first, so the first tab starts at the left edge', () => {
    for (const i of [0, 1, 2]) expect(tabStripScrollFor(starts, starts[i], ends[i], width, 0)).toBe(0);
  });

  it('rests on the start of a whole tab when the selected one is further right', () => {
    // About ends at 500; the leftmost start from which 500 fits in 312 is Data's (200).
    expect(tabStripScrollFor(starts, starts[4], ends[4], width, 0)).toBe(200);
    // Telegram ends at 410; Vessel's start (110) is the leftmost that fits it.
    expect(tabStripScrollFor(starts, starts[3], ends[3], width, 0)).toBe(110);
  });

  it('pulls a sliver back to a boundary even when the selected tab is already in view', () => {
    // The old rule left the strip at 192: the selected tab whole, "Display" or "Vessel" cut.
    expect(tabStripScrollFor(starts, starts[4], ends[4], width, 192)).toBe(200);
  });

  it('does not move a strip already resting on a boundary with the selected tab in view', () => {
    expect(tabStripScrollFor(starts, starts[3], ends[3], width, 200)).toBe(200);
  });

  it('scrolls back left to the selected tab when it is off the left edge', () => {
    expect(tabStripScrollFor(starts, starts[0], ends[0], width, 200)).toBe(0);
    // Vessel fits from the first tab, so the strip goes all the way home.
    expect(tabStripScrollFor(starts, starts[1], ends[1], width, 200)).toBe(0);
  });

  it('starts a tab wider than the strip at its own left edge', () => {
    expect(tabStripScrollFor([0, 100], 100, 600, 312, 0)).toBe(100);
  });
});

describe('Tabs initial scroll', () => {
  // jsdom has no layout. Each tab is 100px wide, laid side by side; the strip
  // is 250px wide. scrollLeft is recorded so the test can read what was set.
  const WIDTH = 100;
  let restore: (() => void)[] = [];
  const define = (proto: object, key: string, desc: PropertyDescriptor) => {
    const prev = Object.getOwnPropertyDescriptor(proto, key);
    Object.defineProperty(proto, key, { configurable: true, ...desc });
    restore.push(() => (prev ? Object.defineProperty(proto, key, prev) : delete (proto as Record<string, unknown>)[key]));
  };
  const scroll = new WeakMap<Element, number>();

  beforeEach(() => {
    define(HTMLElement.prototype, 'offsetLeft', {
      get(this: HTMLElement) {
        if (this.getAttribute('role') !== 'tab') return 0;
        return Array.from(this.parentElement!.children).indexOf(this) * WIDTH;
      },
    });
    define(HTMLElement.prototype, 'offsetWidth', {
      get(this: HTMLElement) { return this.getAttribute('role') === 'tab' ? WIDTH : 0; },
    });
    define(HTMLElement.prototype, 'clientWidth', { get() { return 250; } });
    define(HTMLElement.prototype, 'scrollWidth', {
      get(this: HTMLElement) {
        const tabs = this.querySelectorAll('[role="tab"]').length * WIDTH;
        const tail = parseFloat((this.querySelector('[data-slot="tabs-tail"]') as HTMLElement | null)?.style.width || '0');
        return Math.max(250, tabs + tail);
      },
    });
    define(Element.prototype, 'scrollLeft', {
      get(this: Element) { return scroll.get(this) ?? 0; },
      set(this: Element, v: number) { scroll.set(this, v); },
    });
  });
  afterEach(() => {
    for (const r of restore.reverse()) r();
    restore = [];
  });

  const FIVE: TabItem[] = ['Display', 'Vessel', 'Data', 'Telegram', 'About'].map((l) => ({ id: l.toLowerCase(), label: l }));
  const stripOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

  it('mounts with the first tab at the left edge when the selected one fits', () => {
    const { container } = render(<Tabs items={FIVE} value="vessel" onChange={vi.fn()} />);
    expect(stripOf(container).scrollLeft).toBe(0);
  });

  it('mounts on a tab boundary with the selected tab whole when it is the last', () => {
    const { container } = render(<Tabs items={FIVE} value="about" onChange={vi.fn()} />);
    // About is 400–500: from Telegram (300) it fits in 250, from Data (200) it
    // does not. The strip can only scroll 500 - 250 = 250 on its own, so the
    // tail spacer makes up the other 50 rather than letting it clamp to a sliver.
    const strip = stripOf(container);
    expect(strip.scrollLeft).toBe(300);
    expect(strip.scrollLeft % WIDTH).toBe(0);
    expect((container.querySelector('[data-slot="tabs-tail"]') as HTMLElement).style.width).toBe('50px');
  });

  it('needs no tail when the boundary is within reach', () => {
    const { container } = render(<Tabs items={FIVE} value="telegram" onChange={vi.fn()} />);
    // Telegram is 300–400: the boundary is Data's start (200); max scroll is 500 - 250 = 250, so no tail.
    expect(stripOf(container).scrollLeft).toBe(200);
    const tail = container.querySelector('[data-slot="tabs-tail"]') as HTMLElement;
    expect(tail.style.width).toBe('0px');
  });

  it('snaps a hand scroll to tab starts', () => {
    const { container } = render(<Tabs items={FIVE} value="display" onChange={vi.fn()} />);
    expect(stripOf(container).className).toContain('snap-x');
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).toContain('snap-start');
  });
});
