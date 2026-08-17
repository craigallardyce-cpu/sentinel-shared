import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconnectScheduler } from '../src/backoff';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// random() fixed at 0.5 makes the jitter term exactly zero, so delays are
// deterministic and can be asserted against the pure exponential curve.
const noJitter = { random: () => 0.5 };

describe('createReconnectScheduler', () => {
  it('grows the delay exponentially from the base', () => {
    const s = createReconnectScheduler({ baseMs: 5000, maxMs: 60000, ...noJitter });
    const connect = vi.fn();

    expect(s.peekDelay()).toBe(5000);
    s.schedule(connect);
    expect(s.peekDelay()).toBe(10000);
    s.schedule(connect);
    expect(s.peekDelay()).toBe(20000);
    s.schedule(connect);
    expect(s.peekDelay()).toBe(40000);
  });

  it('caps the delay at maxMs however many attempts fail', () => {
    const s = createReconnectScheduler({ baseMs: 5000, maxMs: 60000, ...noJitter });
    const connect = vi.fn();
    for (let i = 0; i < 20; i++) s.schedule(connect);
    expect(s.peekDelay()).toBe(60000);
  });

  it('fires the connect callback after the scheduled delay', () => {
    const s = createReconnectScheduler({ baseMs: 5000, ...noJitter });
    const connect = vi.fn();
    s.schedule(connect);

    vi.advanceTimersByTime(4999);
    expect(connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('reset() returns the next delay to the floor — the successful-connect case', () => {
    const s = createReconnectScheduler({ baseMs: 5000, ...noJitter });
    const connect = vi.fn();
    s.schedule(connect);
    s.schedule(connect);
    expect(s.peekDelay()).toBe(20000);

    s.reset();
    expect(s.attempts).toBe(0);
    expect(s.peekDelay()).toBe(5000);
  });

  it('only one attempt is ever pending — rescheduling replaces the previous timer', () => {
    const s = createReconnectScheduler({ baseMs: 5000, ...noJitter });
    const connect = vi.fn();
    s.schedule(connect);
    s.schedule(connect);
    s.schedule(connect);

    vi.advanceTimersByTime(120000);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('cancel() prevents a pending attempt from firing', () => {
    const s = createReconnectScheduler({ baseMs: 5000, ...noJitter });
    const connect = vi.fn();
    s.schedule(connect);
    s.cancel();

    vi.advanceTimersByTime(120000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('applies jitter around the delay but never drops below the base', () => {
    const connect = vi.fn();
    // random()=0 puts the jitter at its most negative, which would otherwise
    // undershoot the floor on the very first attempt.
    const low = createReconnectScheduler({ baseMs: 5000, jitter: 0.5, random: () => 0 });
    low.schedule(connect);
    vi.advanceTimersByTime(4999);
    expect(connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledOnce();

    // random()=1 is the most positive jitter: 5000 + 0.5*5000 = 7500.
    const high = createReconnectScheduler({ baseMs: 5000, jitter: 0.5, random: () => 1 });
    const c2 = vi.fn();
    high.schedule(c2);
    vi.advanceTimersByTime(7499);
    expect(c2).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(c2).toHaveBeenCalledOnce();
  });
});
