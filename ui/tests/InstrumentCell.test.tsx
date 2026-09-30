import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InstrumentCell } from '../src/InstrumentCell';

const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-slot="${name}"]`);

describe('InstrumentCell', () => {
  it('draws the label, a mono 700 readout and the unit beside it', () => {
    const { container, getByText } = render(<InstrumentCell label="Depth" value="18.2" unit="ft" />);
    expect(getByText('Depth').className).toContain('text-instrument-label');

    const value = slot(container, 'value')!;
    expect(value.textContent).toBe('18.2');
    expect(value.className).toContain('font-mono');
    expect(value.className).toContain('font-bold');
    expect(value.className).toContain('text-readout');

    const unit = slot(container, 'unit')!;
    expect(unit.textContent).toBe('ft');
    expect(unit.className).toContain('font-mono');
    expect(unit.className).toContain('text-[15px]');
    expect(unit.className).toContain('text-text-muted');
    // Beside the value on its baseline: the two share one baseline-aligned row.
    expect(unit.parentElement).toBe(value.parentElement);
    expect(unit.parentElement!.className).toContain('items-baseline');
  });

  it('uses tabular figures and draws no box of its own', () => {
    const { container } = render(<InstrumentCell label="Wind" value="11.8" unit="kt" />);
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain('tabular-nums');
    expect(cell.className).not.toMatch(/(^|\s)(border|rounded|bg-|shadow)/);
  });

  it('draws 24px with size="instrument"', () => {
    const { container } = render(<InstrumentCell label="SOG" value="7.6" unit="kt" size="instrument" />);
    expect(slot(container, 'value')!.className).toContain('text-instrument');
    expect(slot(container, 'value')!.className).not.toContain('text-readout');
  });

  it('omits the unit and sub line when they are not given', () => {
    const { container } = render(<InstrumentCell label="HDG" value="222°" />);
    expect(slot(container, 'unit')).toBeNull();
    expect(slot(container, 'sub')).toBeNull();
  });

  it('renders a string sub line with its numbers in mono', () => {
    const { container } = render(<InstrumentCell label="Scope" value="4.2" unit=":1" sub="Min 5:1" />);
    const sub = slot(container, 'sub')!;
    expect(sub.textContent).toBe('Min 5:1');
    expect(sub.className).toContain('text-[13px]');
    const mono = sub.querySelectorAll('.font-mono');
    expect(Array.from(mono).map((m) => m.textContent)).toEqual(['5:1']);
  });

  it('passes an element sub line through untouched', () => {
    const { container } = render(<InstrumentCell label="Dist" value="95" sub={<em>custom</em>} />);
    expect(slot(container, 'sub')!.querySelector('em')!.textContent).toBe('custom');
  });

  it.each([
    ['normal', 'text-text-primary', 'text-text-muted'],
    ['warning', 'text-warning', 'text-warning'],
    ['alarm', 'text-red', 'text-red'],
  ] as const)('tone %s colours the value %s and the sub line %s', (tone, valueClass, subClass) => {
    const { container } = render(<InstrumentCell label="Scope" value="4.2" unit=":1" sub="Min 5:1" tone={tone} />);
    expect(slot(container, 'value')!.className).toContain(valueClass);
    expect(slot(container, 'sub')!.className).toContain(subClass);
    // The unit and label stay quiet whatever the tone.
    expect(slot(container, 'unit')!.className).toContain('text-text-muted');
  });

  it('centres its lines with align="center"', () => {
    const { container } = render(<InstrumentCell label="Dist" value="101" align="center" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('items-center');
  });
});
