import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stepper } from '../src/Stepper';

/** The stepper as a screen uses it: the value lives in the parent. */
function Host({ start, min = 0, max = 10, onChange = () => {} }: {
  start: number; min?: number; max?: number; onChange?: (v: number) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <div>
      <output data-testid="value">{value}</output>
      <Stepper value={value} min={min} max={max} onChange={(v) => { onChange(v); setValue(v); }} />
    </div>
  );
}

const value = () => Number(screen.getByTestId('value').textContent);
/** Time passes a repeat interval at a time, with a render between, as it does on a screen. */
const hold = (ms: number) => {
  for (let left = ms; left > 0; left -= 100) act(() => { vi.advanceTimersByTime(Math.min(100, left)); });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Stepper', () => {
  it('steps once on a click', () => {
    render(<Host start={5} />);
    fireEvent.click(screen.getByLabelText('Increase'));
    expect(value()).toBe(6);
    fireEvent.click(screen.getByLabelText('Decrease'));
    expect(value()).toBe(5);
  });

  it('keeps stepping while held, from the value it has reached', () => {
    // It used to repeat from the value at the moment of the press: 6, 6, 6.
    render(<Host start={2} />);
    fireEvent.mouseDown(screen.getByLabelText('Increase'));
    hold(400);
    hold(100);
    expect(value()).toBe(3);
    hold(100);
    expect(value()).toBe(4);
    hold(300);
    expect(value()).toBe(7);
    fireEvent.mouseUp(screen.getByLabelText('Increase'));
    hold(1000);
    expect(value()).toBe(7);
  });

  it('stops repeating at the limit, where the disabled button never reports the release', () => {
    const onChange = vi.fn();
    render(<Host start={8} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByLabelText('Increase'));
    hold(400 + 200);
    expect(value()).toBe(10);
    expect(screen.getByLabelText('Increase')).toBeDisabled();
    const calls = onChange.mock.calls.length;

    // No mouseup arrives. Nothing more is called, however long it is left.
    hold(5000);
    expect(onChange.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when one press is reported as a touch and then as a mouse', () => {
    render(<Host start={5} />);
    const plus = screen.getByLabelText('Increase');
    fireEvent.touchStart(plus);
    fireEvent.mouseDown(plus);
    fireEvent.touchEnd(plus);
    fireEvent.mouseUp(plus);
    expect(vi.getTimerCount()).toBe(0);
    hold(2000);
    expect(value()).toBe(5);
  });

  it('stops when the screen it is on goes away', () => {
    const onChange = vi.fn();
    const { unmount } = render(<Host start={2} max={1000} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByLabelText('Increase'));
    hold(600);
    const calls = onChange.mock.calls.length;
    unmount();
    hold(2000);
    expect(onChange.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
