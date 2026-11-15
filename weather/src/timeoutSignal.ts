/**
 * A signal that aborts after `ms`, on any runtime the apps run on.
 *
 * `AbortSignal.timeout` is the short way to write this and is missing from
 * Android System WebView before 103, where calling it throws a TypeError before
 * the request is ever made: the forecast, the wind grid and the wave grid all
 * failed there with "AbortSignal.timeout is not a function", which reads like
 * a network fault and is not one. Where it is missing this builds the same
 * thing from an AbortController, and where even that is missing the request
 * goes without a timeout rather than not at all.
 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  const native = typeof AbortSignal !== 'undefined'
    ? (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
    : undefined;
  if (typeof native === 'function') return native.call(AbortSignal, ms);
  if (typeof AbortController === 'undefined') return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Under Node the timer must not hold a finished process open.
  (timer as unknown as { unref?: () => void }).unref?.();
  return controller.signal;
}
