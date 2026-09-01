/**
 * The vocabulary every other file in this package is written against.
 *
 * The idea the package exists to enforce: a setting is a *declaration*, not a
 * storage call. It says what it is, what it defaults to, and — the load-bearing
 * part — which layers are allowed to hold it. Nothing else in the fleet gets to
 * decide any of those three, which is how one boat's name stopped living in
 * four places under three names.
 */
/**
 * Broadest first, narrowest last. Resolution walks this order and keeps the LAST
 * layer that answered, so a device override beats the boat, which beats the
 * account. Changing this array changes what wins; nothing else encodes it.
 */
export const SCOPE_ORDER = ['account', 'vessel', 'host', 'device'];
