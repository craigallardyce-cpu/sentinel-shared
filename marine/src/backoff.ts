/**
 * Reconnect scheduling for NMEA streams.
 *
 * A fixed retry interval is wrong for the boat case: against a gateway that is
 * simply off — boat unpowered, laptop ashore — a flat 5s retry is 720 connection
 * attempts an hour, each waking the radio on Android and burning battery for a
 * connection that cannot succeed. Backing off preserves the fast first retry for
 * a transient blip while degrading gracefully when nothing is listening.
 */

export interface ReconnectSchedulerOptions {
  /** Delay before the first retry, and the floor after a reset. */
  baseMs?: number;
  /** Ceiling for the delay, however many attempts have failed. */
  maxMs?: number;
  /**
   * Fraction of the delay to randomise by, +/-. Stops several clients that
   * dropped at the same moment from retrying in lockstep.
   */
  jitter?: number;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

/**
 * This package is compiled with `lib: ES2020` only — deliberately no DOM and no
 * Node types, so the marine maths cannot reach for host APIs by accident. Timers
 * are therefore taken from the host explicitly rather than by widening the lib.
 */
const host = globalThis as unknown as {
  setTimeout: (handler: () => void, timeout: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export interface ReconnectScheduler {
  /** Queue a reconnect attempt, backing off further each consecutive call. */
  schedule(connect: () => void): void;
  /** Call on a successful connect so the next failure starts from the floor. */
  reset(): void;
  /** Cancel any pending attempt. Safe to call repeatedly. */
  cancel(): void;
  /** The delay the next schedule() would use, before jitter. For tests/logging. */
  peekDelay(): number;
  /** Consecutive failures since the last reset. */
  readonly attempts: number;
}

export function createReconnectScheduler(options: ReconnectSchedulerOptions = {}): ReconnectScheduler {
  const baseMs = options.baseMs ?? 5000;
  const maxMs = options.maxMs ?? 60000;
  const jitter = options.jitter ?? 0.25;
  const random = options.random ?? Math.random;

  let attempts = 0;
  let timer: unknown = null;

  const rawDelay = () => Math.min(baseMs * 2 ** attempts, maxMs);

  return {
    get attempts() {
      return attempts;
    },
    peekDelay: rawDelay,
    schedule(connect: () => void) {
      if (timer) host.clearTimeout(timer);
      const spread = rawDelay() * jitter;
      // Uniform in [delay - spread, delay + spread], never below the floor.
      const delay = Math.max(baseMs, Math.round(rawDelay() + (random() * 2 - 1) * spread));
      attempts += 1;
      timer = host.setTimeout(() => {
        timer = null;
        connect();
      }, delay);
    },
    reset() {
      attempts = 0;
      if (timer) {
        host.clearTimeout(timer);
        timer = null;
      }
    },
    cancel() {
      if (timer) {
        host.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
