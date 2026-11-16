import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, toast } from '../src/Toast';

beforeEach(() => {
  vi.useFakeTimers();
  act(() => toast.clear());
});
afterEach(() => {
  act(() => toast.clear());
  vi.useRealTimers();
});

describe('toast timing', () => {
  it('dismisses a toast after its own duration, whatever else arrives meanwhile', () => {
    render(<ToastProvider><div /></ToastProvider>);
    act(() => { toast.info('First', { duration: 4000 }); });
    expect(screen.getByText('First')).toBeInTheDocument();

    // Another toast every second. Each one re-renders the list, and that used
    // to start the first toast's four seconds again.
    for (let i = 0; i < 3; i++) {
      act(() => { vi.advanceTimersByTime(1000); });
      act(() => { toast.info(`Later ${i}`, { duration: 60000 }); });
    }
    expect(screen.getByText('First')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Later 2')).toBeInTheDocument();
  });
});
