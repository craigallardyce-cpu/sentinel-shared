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
