import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../src/Button';
import type { ButtonVariant } from '../src/Button';

/*
  The layout hand-over. `cn` concatenates, so a caller's class only reliably
  controls a property the Button does not also set: two utilities for the same
  property resolve by stylesheet order, not attribute order. These tests
  therefore assert absence -- that the Button emits nothing a `bare` caller has
  taken over -- because a test that checked the caller's class was present
  would pass on exactly the bug it is meant to catch.
*/
const ALL: ButtonVariant[] = ['primary', 'secondary', 'accent', 'success', 'alarm', 'danger', 'ghost', 'link'];

const tokens = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

// Classes that set a property `bare` hands to the caller. Unprefixed only: a
// `before:` or `focus-visible:` class styles something else.
const LAYOUT_PROPERTY =
  /^(?:inline-flex|flex|inline-block|block|grid|items-\S+|justify-\S+|h-\S+|min-h-\S+|px-\S+|py-\S+|p-\S+|gap-\S+|rounded(?:-\S+)?|text-\[\S+\]|text-(?:xs|sm|base|lg)|font-(?:medium|bold|semibold|normal)|whitespace-\S+)$/;

const leaked = () => tokens(screen.getByRole('button')).filter((c) => LAYOUT_PROPERTY.test(c));

describe('Button layout="bare"', () => {
  it('emits no layout class for any variant, so className owns them', () => {
    for (const variant of ALL) {
      const { unmount } = render(<Button variant={variant} layout="bare" touchFloor={false}>Go</Button>);
      expect({ variant, leaked: leaked() }).toEqual({ variant, leaked: [] });
      unmount();
    }
  });

  it('also stays out of the way when lit', () => {
    render(<Button layout="bare" active touchFloor={false}>Vessel</Button>);
    expect(leaked()).toEqual([]);
  });

  it('keeps the colours, focus ring and the 44px floor by default', () => {
    render(
      <Button layout="bare" className="w-full flex justify-between items-center px-3 py-2">
        <span>Kestrel</span>
        <span>12</span>
      </Button>
    );
    const cls = tokens(screen.getByRole('button'));
    expect(cls).toContain('bg-bg-card');
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('min-h-11');
    expect(cls).toContain('justify-between');
    expect(cls).not.toContain('justify-center');
    expect(cls).not.toContain('inline-flex');
  });

  it('drops the floor only when asked', () => {
    render(<Button layout="bare" touchFloor={false}>Go</Button>);
    expect(tokens(screen.getByRole('button'))).not.toContain('min-h-11');
  });

  it('ignores size, whose height and padding would outrank the caller', () => {
    render(<Button layout="bare" size="md">Go</Button>);
    const cls = tokens(screen.getByRole('button'));
    expect(cls).not.toContain('h-11');
    expect(cls).not.toContain('px-4');
  });

  it('leaves the default layout exactly as it was', () => {
    render(<Button>Go</Button>);
    const cls = tokens(screen.getByRole('button'));
    for (const c of ['inline-flex', 'items-center', 'justify-center', 'font-medium', 'h-11', 'px-4']) {
      expect(cls).toContain(c);
    }
    expect(cls).not.toContain('min-h-11');
  });
});

describe('Button variant="link"', () => {
  it('is cyan text with no fill, no padding and no height', () => {
    render(<Button variant="link" size="sm">Recentre</Button>);
    const cls = tokens(screen.getByRole('button'));
    expect(cls).toContain('text-cyan');
    expect(cls).toContain('bg-transparent');
    expect(cls.filter((c) => /^(?:hover:)?bg-(?!transparent)/.test(c))).toEqual([]);
    expect(cls.filter((c) => /^(?:h|min-h|px|py|p)-/.test(c))).toEqual([]);
    expect(cls).toContain('text-[13px]');
  });

  it("sets no font weight, so the caller's `font-bold` has nothing to fight", () => {
    render(<Button variant="link" className="font-bold">Recentre</Button>);
    const weights = tokens(screen.getByRole('button')).filter((c) => /^font-(?:medium|bold|semibold|normal)$/.test(c));
    expect(weights).toEqual(['font-bold']);
  });

  it('has a visible focus ring', () => {
    render(<Button variant="link">Manage plan</Button>);
    expect(tokens(screen.getByRole('button'))).toContain('focus-visible:ring-2');
  });

  it('meets the touch floor with a hit area that does not move the layout', () => {
    const { unmount } = render(<Button variant="link">Install app</Button>);
    const cls = tokens(screen.getByRole('button'));
    expect(cls).toContain('before:h-11');
    expect(cls).toContain('relative');
    unmount();

    render(<Button variant="link" touchFloor={false}>Install app</Button>);
    const off = tokens(screen.getByRole('button'));
    expect(off.filter((c) => c.startsWith('before:'))).toEqual([]);
    expect(off).not.toContain('relative');
  });

  it('with layout="bare" sits in running text: no display, size or weight of its own', () => {
    render(<p>Premium · <Button variant="link" layout="bare">Manage plan</Button></p>);
    expect(leaked()).toEqual([]);
    expect(tokens(screen.getByRole('button'))).toContain('text-cyan');
  });
});
