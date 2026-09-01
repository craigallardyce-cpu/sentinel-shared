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

/**
 * Like `@sentinel/marine`, this package compiles with `lib: ES2020` and no DOM
 * and no Node types, so a validator cannot reach for a host API by accident.
 * `URL` is the one host global the set genuinely needs, so it is taken
 * explicitly — and treated as possibly absent, because a runtime without it
 * should degrade to "cannot validate this URL" rather than throw on import.
 */
const host = globalThis as unknown as {
  URL?: new (input: string) => { protocol: string };
};

function make<T>(name: string, parse: (raw: unknown) => T | undefined, serialize: (value: T) => string): SettingType<T> {
  return { name, parse, serialize };
}

/** The string a store handed back, trimmed, or null when there is nothing there. */
function text(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface StringOptions {
  /** Treat `''` as a real value rather than as absence. Off by default. */
  allowEmpty?: boolean;
  maxLength?: number;
}

export function stringType(options: StringOptions = {}): SettingType<string> {
  const { allowEmpty = false, maxLength = 512 } = options;
  return make<string>(
    'string',
    (raw) => {
      if (allowEmpty && typeof raw === 'string' && raw.trim().length === 0) return '';
      const value = text(raw);
      if (value === null) return undefined;
      return value.length <= maxLength ? value : undefined;
    },
    (value) => value
  );
}

/**
 * Booleans, read leniently because the fleet has written them three ways:
 * `'true'`, `'1'` and — in HarborSentinel's SQLite — an INTEGER. Written one way.
 */
export const boolType: SettingType<boolean> = make<boolean>(
  'bool',
  (raw) => {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const value = text(raw);
    if (value === null) return undefined;
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
    return undefined;
  },
  (value) => (value ? 'true' : 'false')
);

export interface NumberOptions {
  min?: number;
  max?: number;
}

/**
 * Out of range is `undefined`, not clamped.
 *
 * Clamping is right when a person just typed something — `POST /config` clamps
 * the AIS limit rather than trusting the client, and should keep doing so at
 * that boundary. It is wrong when *reading a store*: a value outside the
 * declared range means the layer holds something this build no longer
 * understands, and silently bending it to the nearest legal number would hide
 * that. Falling through to the next layer is both safer and visible.
 */
function numeric(name: string, integral: boolean, options: NumberOptions): SettingType<number> {
  const { min, max } = options;
  return make<number>(
    name,
    (raw) => {
      const asText = typeof raw === 'number' ? null : text(raw);
      const value = typeof raw === 'number' ? raw : asText === null ? NaN : Number(asText);
      if (!Number.isFinite(value)) return undefined;
      if (integral && !Number.isInteger(value)) return undefined;
      if (min !== undefined && value < min) return undefined;
      if (max !== undefined && value > max) return undefined;
      return value;
    },
    (value) => String(value)
  );
}

export function intType(options: NumberOptions = {}): SettingType<number> {
  return numeric('int', true, options);
}

export function numberType(options: NumberOptions = {}): SettingType<number> {
  return numeric('number', false, options);
}

/** A closed set of string values. Anything outside it falls through. */
export function oneOf<T extends string>(values: readonly T[]): SettingType<T> {
  const allowed = new Set<string>(values);
  return make<T>(
    `oneOf(${values.join('|')})`,
    (raw) => {
      const value = text(raw);
      return value !== null && allowed.has(value) ? (value as T) : undefined;
    },
    (value) => value
  );
}

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

function makeHost(options: HostOptions = {}): SettingType<string> {
  const { allowEmpty = false } = options;
  return make<string>(
  'host',
  (raw) => {
    if (allowEmpty && typeof raw === 'string' && raw.trim().length === 0) return '';
    const value = text(raw);
    if (value === null) return undefined;
    if (/\s/.test(value) || value.includes('/') || value.includes('@')) return undefined;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
    if (value.startsWith('[')) return /^\[[0-9a-f:]+\]$/i.test(value) ? value : undefined;
    if (value.includes(':')) return undefined;
    return /^[a-z0-9._-]+$/i.test(value) ? value : undefined;
  },
  (value) => value
  );
}

export function hostTypeWith(options: HostOptions = {}): SettingType<string> {
  return makeHost(options);
}

export const hostType: SettingType<string> = makeHost();

export const portType: SettingType<number> = make<number>(
  'port',
  (raw) => intType({ min: 1, max: 65535 }).parse(raw),
  (value) => String(value)
);

export interface UrlOptions {
  allowEmpty?: boolean;
  protocols?: readonly string[];
}

/**
 * An absolute URL. Empty is allowed where it carries meaning — an unset backend
 * URL is how both apps say "standalone, no PC to talk to", and that is a value
 * rather than a gap.
 */
export function urlType(options: UrlOptions = {}): SettingType<string> {
  const { allowEmpty = false, protocols = ['http:', 'https:'] } = options;
  return make<string>(
    'url',
    (raw) => {
      if (allowEmpty && typeof raw === 'string' && raw.trim().length === 0) return '';
      const value = text(raw);
      if (value === null) return undefined;
      if (host.URL === undefined) return undefined;
      let parsed: { protocol: string };
      try {
        parsed = new host.URL(value);
      } catch {
        return undefined;
      }
      return protocols.includes(parsed.protocol) ? value.replace(/\/+$/, '') : undefined;
    },
    (value) => value
  );
}

/**
 * Nine digits, or empty for "not known".
 *
 * The fallback matters more here than anywhere else in this file. A wrong MMSI
 * does not fail loudly — it silently stops own ship being suppressed from the
 * AIS proximity alarm, so the boat sets off its own alarm. Falling back to
 * "not known" is safe, because the alarm refuses to run at all without one;
 * falling back to a half-typed number is not.
 */
export const mmsiType: SettingType<string> = make<string>(
  'mmsi',
  (raw) => {
    if (raw === null || raw === undefined) return undefined;
    const value = String(raw).trim();
    if (value.length === 0) return '';
    return /^\d{9}$/.test(value) ? value : undefined;
  },
  (value) => value
);

/**
 * A list, stored as JSON.
 *
 * One bad element invalidates the whole list rather than being dropped. A
 * partially-parsed list is worse than no list: OceanSentinel's log book records
 * whichever NMEA fields this array names, and silently recording fewer of them
 * than the navigator chose is a wrong log entry that nothing reports.
 */
export function listType<T>(item: SettingType<T>): SettingType<T[]> {
  return make<T[]>(
    `list(${item.name})`,
    (raw) => {
      let source: unknown = raw;
      if (typeof raw === 'string') {
        const value = text(raw);
        if (value === null) return undefined;
        try {
          source = JSON.parse(value);
        } catch {
          return undefined;
        }
      }
      if (!Array.isArray(source)) return undefined;
      const out: T[] = [];
      for (const element of source) {
        const parsed = item.parse(element);
        if (parsed === undefined) return undefined;
        out.push(parsed);
      }
      return out;
    },
    (value) => JSON.stringify(value.map((element) => item.serialize(element)))
  );
}
