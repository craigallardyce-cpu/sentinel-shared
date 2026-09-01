/**
 * The type and validator set.
 *
 * Every one of these is a rule the fleet already applies somewhere, written down
 * once instead of at each read site. `mmsiType` is HarborSentinel's "an MMSI is
 * nine digits, anything else is stored as null rather than half a number";
 * `portType` and `hostType` are the parsing the settings modals do by hand in
 * both apps; the range clamps on `intType` are the ones `POST /config` performs
 * on `ais_proximity_limit`, with the comment explaining that a limit of 0 would
 * put every AIS target permanently inside the ring.
 *
 * The shared contract: `parse` never throws and never guesses. Anything it
 * cannot make sense of becomes `undefined`, which resolution reads as "this
 * layer has nothing" and falls through.
 */
import type { SettingType } from './types.js';
export interface StringOptions {
    /** Treat `''` as a real value rather than as absence. Off by default. */
    allowEmpty?: boolean;
    maxLength?: number;
}
export declare function stringType(options?: StringOptions): SettingType<string>;
/**
 * Booleans, read leniently because the fleet has written them three ways:
 * `'true'`, `'1'` and — in HarborSentinel's SQLite — an INTEGER. Written one way.
 */
export declare const boolType: SettingType<boolean>;
export interface NumberOptions {
    min?: number;
    max?: number;
}
export declare function intType(options?: NumberOptions): SettingType<number>;
export declare function numberType(options?: NumberOptions): SettingType<number>;
/** A closed set of string values. Anything outside it falls through. */
export declare function oneOf<T extends string>(values: readonly T[]): SettingType<T>;
/**
 * A hostname or address with no scheme and no port.
 *
 * Both apps accept a scheme and a `host:port` in the same field and then strip
 * them at the far end — HarborSentinel's `POST /config` runs a loop peeling
 * `tcp://` and friends off the front and a regex pulling the port off the back.
 * That normalisation belongs at the edge where a person types, not in the store:
 * by the time a value is being written, a host is a host.
 *
 * A bare IPv6 literal must be bracketed. Unbracketed, `fe80::1` is
 * indistinguishable from a `host:port` pair, and `splitPoolKey` in
 * `@sentinel/marine` splits pool keys on the rightmost colon on exactly that
 * assumption.
 */
export interface HostOptions {
    /** Treat `''` as a real value — "no address configured" — rather than as absence. */
    allowEmpty?: boolean;
}
export declare function hostTypeWith(options?: HostOptions): SettingType<string>;
export declare const hostType: SettingType<string>;
export declare const portType: SettingType<number>;
export interface UrlOptions {
    allowEmpty?: boolean;
    protocols?: readonly string[];
}
/**
 * An absolute URL. Empty is allowed where it carries meaning — an unset backend
 * URL is how both apps say "standalone, no PC to talk to", and that is a value
 * rather than a gap.
 */
export declare function urlType(options?: UrlOptions): SettingType<string>;
/**
 * Nine digits, or empty for "not known".
 *
 * The fallback matters more here than anywhere else in this file. A wrong MMSI
 * does not fail loudly — it silently stops own ship being suppressed from the
 * AIS proximity alarm, so the boat sets off its own alarm. Falling back to
 * "not known" is safe, because the alarm refuses to run at all without one;
 * falling back to a half-typed number is not.
 */
export declare const mmsiType: SettingType<string>;
/**
 * A list, stored as JSON.
 *
 * One bad element invalidates the whole list rather than being dropped. A
 * partially-parsed list is worse than no list: OceanSentinel's log book records
 * whichever NMEA fields this array names, and silently recording fewer of them
 * than the navigator chose is a wrong log entry that nothing reports.
 */
export declare function listType<T>(item: SettingType<T>): SettingType<T[]>;
