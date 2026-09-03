import type { StorageLike } from '../src/storage';

/**
 * An in-memory `StorageLike`, which is the whole point of the package taking
 * storage as a parameter: these suites can exercise the real read and write
 * paths without a DOM, and without one test's keys leaking into the next.
 *
 * Reaching for the `localStorage` global instead is what broke these tests
 * before. When `storage` became a parameter, calls left in the old shape
 * (`readEntitlements(KEY)`) passed the key string where the store belongs, so
 * every access threw `undefined is not an object`. The failures that surfaced
 * were the honest ones; worse were the two tests that kept passing, because
 * both expected the value that the swallowed exception happens to produce.
 */
export interface MemoryStorage extends StorageLike {
  /** Drop everything, for `afterEach`. */
  clear(): void;
  /** How many keys are held — enough to assert nothing was written. */
  size(): number;
}

export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    size: () => map.size
  };
}
