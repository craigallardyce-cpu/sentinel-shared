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
export declare function createReconnectScheduler(options?: ReconnectSchedulerOptions): ReconnectScheduler;
