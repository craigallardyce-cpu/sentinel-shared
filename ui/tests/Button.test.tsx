import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../src/Button';
import type { ButtonVariant } from '../src/Button';

/**
 * The three variants added in the button-adoption pass are the reason this file
 * exists: they were added because 11 of the fleet's 26 hand-rolled buttons had
 * no correct target, and a variant that silently renders as another one would
 * put those 11 straight back where they started.
 */
const ALL: ButtonVariant[] = ['primary', 'secondary', 'accent', 'success', 'alarm', 'danger', 'ghost'];

describe('Button', () => {
  it('renders every declared variant, each with its own classes', () => {
    const seen = new Map<ButtonVariant, string>();

    for (const variant of ALL) {
      const { unmount } = render(<Button variant={variant}>Go</Button>);
      seen.set(variant, screen.getByRole('button').className);
      unmount();
    }

    expect([...seen.keys()]).toEqual(ALL);
    // Distinct, so a typo in the VARIANT map cannot make two variants identical.
    expect(new Set(seen.values()).size).toBe(ALL.length);
  });

  /*
    The semantic half of why `accent` was added. `active` was the only variant
    close to it visually, and using it for an action would announce a button as
    a toggle that is stuck on -- which is the regression this variant exists to
    avoid, and it is invisible unless asserted.
  */
  it('sets aria-pressed only for `active`, never for a plain variant', () => {
    const { unmount } = render(<Button variant="accent">Open the monitor</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
    unmount();

    render(<Button variant="accent" active>Layer shown</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('carries the fleet colour for the variants that had none', () => {
    const cases: [ButtonVariant, string][] = [
      ['accent', 'bg-cyan/15'],
      ['success', 'bg-green'],
      ['alarm', 'bg-red'],
    ];
    for (const [variant, cls] of cases) {
      const { unmount } = render(<Button variant={variant}>Go</Button>);
      expect(screen.getByRole('button').className).toContain(cls);
      unmount();
    }
  });

  /*
    `alarm` fills with the pale --color-red and `danger` with the deep
    --color-red-dim. They must not collapse into each other: acknowledging an
    alarm at 04:00 wants to be the brightest thing on the screen, and a
    destructive action wants to be resistible.
  */
  it('keeps `alarm` and `danger` distinct', () => {
    const { unmount } = render(<Button variant="alarm">Acknowledge</Button>);
    const alarm = screen.getByRole('button').className;
    unmount();

    render(<Button variant="danger">Delete</Button>);
    const danger = screen.getByRole('button').className;

    expect(alarm).not.toBe(danger);
    expect(alarm).toContain('bg-red');
    expect(alarm).not.toContain('bg-red-dim');
    expect(danger).toContain('bg-red-dim');
  });

  it('does not fire while loading, and disables itself', () => {
    const onClick = vi.fn();
    render(<Button variant="success" loading onClick={onClick}>Mark done</Button>);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type=button, so it cannot submit a form by accident', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});
