import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Stepper } from '../src/Stepper';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const surfaceClassName = 'border-slate-700 bg-slate-800';
const trackClassName = 'bg-slate-800';

describe('Stepper', () => {
  it('calls onChange with the incremented value when + is clicked', () => {
    const onChange = vi.fn();
    render(<Stepper value={10} min={0} max={20} step={5} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);
    fireEvent.click(screen.getByLabelText('Increase'));
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it('calls onChange with the decremented value when - is clicked', () => {
    const onChange = vi.fn();
    render(<Stepper value={10} min={0} max={20} step={5} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);
    fireEvent.click(screen.getByLabelText('Decrease'));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('clamps to max and disables the increase button at the ceiling', () => {
    const onChange = vi.fn();
    render(<Stepper value={20} min={0} max={20} step={5} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);
    expect(screen.getByLabelText('Increase')).toBeDisabled();
  });

  it('clamps to min and disables the decrease button at the floor', () => {
    const onChange = vi.fn();
    render(<Stepper value={0} min={0} max={20} step={5} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);
    expect(screen.getByLabelText('Decrease')).toBeDisabled();
  });

  it('defaults step to 1 when not provided', () => {
    const onChange = vi.fn();
    render(<Stepper value={10} min={0} max={20} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);
    fireEvent.click(screen.getByLabelText('Increase'));
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it('repeats adjustment on a held mouse-down after the hold delay', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<Stepper value={0} min={0} max={100} step={1} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);

    fireEvent.mouseDown(screen.getByLabelText('Increase'));
    vi.advanceTimersByTime(400); // HOLD_DELAY_MS
    vi.advanceTimersByTime(100); // one HOLD_REPEAT_MS tick
    fireEvent.mouseUp(screen.getByLabelText('Increase'));

    // First repeat tick fires after the hold delay elapses.
    expect(onChange).toHaveBeenCalled();
  });

  it('suppresses the click-adjust after a hold has already repeated', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<Stepper value={0} min={0} max={100} step={1} onChange={onChange} surfaceClassName={surfaceClassName} trackClassName={trackClassName} />);

    const button = screen.getByLabelText('Increase');
    fireEvent.mouseDown(button);
    vi.advanceTimersByTime(400);
    vi.advanceTimersByTime(100);
    fireEvent.mouseUp(button);
    const callsFromHold = onChange.mock.calls.length;
    fireEvent.click(button); // synthetic click after a real hold-repeat should be swallowed
    expect(onChange.mock.calls.length).toBe(callsFromHold);
  });

  it('applies the provided surfaceClassName and trackClassName', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Stepper value={10} min={0} max={20} onChange={onChange} surfaceClassName="border-red-500 bg-red-900" trackClassName="bg-red-900" />
    );
    expect(screen.getByLabelText('Increase').className).toContain('border-red-500');
    expect(screen.getByLabelText('Increase').className).toContain('bg-red-900');
    expect(container.querySelector('.bg-red-900')).toBeTruthy();
  });
});
