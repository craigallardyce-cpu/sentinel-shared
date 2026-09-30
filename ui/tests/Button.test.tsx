import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../src/Button';
import type { ButtonVariant, ButtonSize } from '../src/Button';

/**
 * Six variants (fit-and-finish): primary, secondary, ghost, link, danger and
 * alarm. `success` and `accent` stay accepted as deprecated aliases, so the
 * apps keep compiling until Wave 2 moves them off, and each must draw exactly
 * as the variant it now stands for.
 */
const CANONICAL: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'link', 'danger', 'alarm'];

const classOf = (props: React.ComponentProps<typeof Button>) => {
  const { unmount } = render(<Button {...props}>Go</Button>);
  const cls = screen.getByRole('button').className;
  unmount();
  return cls;
};

describe('Button', () => {
  it('renders every canonical variant with its own classes', () => {
    const seen = new Map<ButtonVariant, string>();
    for (const variant of CANONICAL) seen.set(variant, classOf({ variant }));
    // Distinct, so a typo in the VARIANT map cannot make two variants identical.
    expect(new Set(seen.values()).size).toBe(CANONICAL.length);
  });

  it('keeps `alarm` and `danger` distinct', () => {
    const alarm = classOf({ variant: 'alarm' });
    const danger = classOf({ variant: 'danger' });
    expect(alarm).not.toBe(danger);
    expect(alarm).toContain('bg-red');
    expect(alarm).not.toContain('bg-red-dim');
    expect(danger).toContain('bg-red-dim');
  });

  it('never glows: no variant, size or state sets a halo', () => {
    for (const variant of [...CANONICAL, 'success', 'accent'] as ButtonVariant[]) {
      for (const active of [false, true]) {
        const cls = classOf({ variant, active });
        expect(cls, `${variant}${active ? ' (active)' : ''}`).not.toMatch(/shadow-\[0_0|glow|drop-shadow/);
      }
    }
  });

  it('sets aria-pressed only for `active`, never for a plain variant', () => {
    const { unmount } = render(<Button variant="secondary">Open the monitor</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
    unmount();

    render(<Button variant="secondary" active>Layer shown</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not fire while loading, and disables itself', () => {
    const onClick = vi.fn();
    render(<Button variant="primary" loading onClick={onClick}>Mark done</Button>);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type=button, so it cannot submit a form by accident', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('sets labels in Inter 600 with no casing or tracking of its own', () => {
    const cls = classOf({ variant: 'primary' }).split(/\s+/);
    expect(cls).toContain('font-sans');
    expect(cls).toContain('font-semibold');
    expect(cls.filter((c) => /^(uppercase|font-mono|tracking-)/.test(c))).toEqual([]);
  });

  it('uses the state-change motion tokens', () => {
    const cls = classOf({}).split(/\s+/);
    expect(cls).toContain('duration-[var(--motion-state)]');
    expect(cls).toContain('ease-[var(--motion-ease)]');
  });
});

describe('Button sizes', () => {
  const heightOf = (size: ButtonSize) => classOf({ size }).split(/\s+/).filter((c) => /^h-\d+$/.test(c));

  it('is 48px by default and 40px dense', () => {
    expect(heightOf('md')).toEqual(['h-12']);
    expect(classOf({}).split(/\s+/)).toContain('h-12');
    expect(heightOf('sm')).toEqual(['h-10']);
  });

  it('draws the deprecated 32px `dense` at 40px, the same as `sm`', () => {
    expect(heightOf('dense')).toEqual(['h-10']);
    expect(classOf({ size: 'dense' })).toBe(classOf({ size: 'sm' }));
  });

  it('draws both sizes at the control radius', () => {
    for (const size of ['md', 'sm', 'dense'] as ButtonSize[]) {
      expect(classOf({ size }).split(/\s+/)).toContain('rounded-md');
    }
  });
});

describe('deprecated Button variants', () => {
  it('draws `success` exactly as `primary` (green is not an action)', () => {
    expect(classOf({ variant: 'success' })).toBe(classOf({ variant: 'primary' }));
    expect(classOf({ variant: 'success' })).not.toContain('bg-green');
    expect(classOf({ variant: 'success' })).toContain('bg-cyan');
  });

  it('draws `accent` exactly as `secondary`', () => {
    expect(classOf({ variant: 'accent' })).toBe(classOf({ variant: 'secondary' }));
    expect(classOf({ variant: 'accent' })).not.toContain('bg-cyan/15');
  });

  it('keeps the aliases working with `active`, `size` and `layout`', () => {
    expect(classOf({ variant: 'success', size: 'dense', active: true })).toBe(
      classOf({ variant: 'primary', size: 'sm', active: true })
    );
    expect(classOf({ variant: 'accent', layout: 'bare' })).toBe(classOf({ variant: 'secondary', layout: 'bare' }));
  });
});
