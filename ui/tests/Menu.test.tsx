import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useRef, useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MenuPanel, MenuItem, MenuDivider, useDismiss } from '../src/Menu';

afterEach(cleanup);

function Harness({ onPick = vi.fn() }: { onPick?: (what: string) => void }) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div>
      <button type="button">Outside</button>
      <span ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}>Actions</button>
        {open && (
          <MenuPanel label="Voyage actions">
            <MenuItem onClick={() => onPick('rename')}>Rename voyage</MenuItem>
            <MenuItem onClick={() => onPick('settings')} disabled>Log settings</MenuItem>
            <MenuItem onClick={() => onPick('web')}>Web logbook</MenuItem>
            <MenuDivider />
            <MenuItem tone="danger" onClick={() => onPick('delete')}>Delete voyage</MenuItem>
          </MenuPanel>
        )}
      </span>
    </div>
  );
}

const isOpen = () => screen.queryByRole('menu') !== null;

describe('Menu', () => {
  it('is a named menu of menu items', () => {
    render(<Harness />);
    expect(screen.getByRole('menu', { name: 'Voyage actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('closes on Escape and on a press outside, but not on a press inside', () => {
    render(<Harness />);
    fireEvent.mouseDown(screen.getByText('Rename voyage'));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByText('Actions'));
    expect(isOpen()).toBe(true);
    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(isOpen()).toBe(false);
  });

  it('passes the click to the item', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByText('Delete voyage'));
    expect(onPick).toHaveBeenCalledWith('delete');
  });

  it('moves between enabled items with the arrow keys, Home and End, skipping a disabled one', () => {
    render(<Harness />);
    const menu = screen.getByRole('menu');
    const item = (name: string) => screen.getByRole('menuitem', { name });
    item('Rename voyage').focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(item('Web logbook')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(item('Delete voyage')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(item('Rename voyage')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(item('Delete voyage')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(item('Rename voyage')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(item('Delete voyage')).toHaveFocus();
  });

  it('draws rows at the 48px touch floor, a danger item in red, and no glow', () => {
    render(<Harness />);
    const del = screen.getByRole('menuitem', { name: 'Delete voyage' });
    expect(del.className).toContain('min-h-12');
    expect(del.className).toContain('text-red');
    expect(screen.getByRole('menu').className).toContain('shadow-[var(--panel-shadow)]');
  });
});
