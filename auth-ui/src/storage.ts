/**
 * Where this package keeps the access flag, the offline grant and the
 * entitlement cache.
 *
 * Taken from the app rather than reached for. `@sentinel/auth-ui` used to call
 * the `localStorage` global at sixteen sites, which had three costs: it could
 * not run anywhere without a DOM, it could not be tested without one, and — the
 * one that actually bit — the keys it wrote were composed at runtime from
 * `accessStorageKey`, so they existed in no source file and no settings registry
 * and no drift check could see them. They turned up only by reading a real
 * install's storage.
 *
 * Structurally identical to `@sentinel/settings`'s `StorageLike`, and
 * deliberately not imported from it: a three-method interface is not worth a
 * dependency between two shared packages, and `browserStorage()` from that
 * package satisfies this one on sight.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
