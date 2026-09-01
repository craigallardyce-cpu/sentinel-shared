"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.mmsiType = exports.portType = exports.hostType = exports.boolType = void 0;
exports.stringType = stringType;
exports.intType = intType;
exports.numberType = numberType;
exports.oneOf = oneOf;
exports.urlType = urlType;
exports.listType = listType;
exports.shapeType = shapeType;
/**
 * Like `@sentinel/marine`, this package compiles with `lib: ES2020` and no DOM
 * and no Node types, so a validator cannot reach for a host API by accident.
 * `URL` is the one host global the set genuinely needs, so it is taken
 * explicitly — and treated as possibly absent, because a runtime without it
 * should degrade to "cannot validate this URL" rather than throw on import.
 */
const host = globalThis;
function make(name, parse, serialize) {
    return { name, parse, serialize };
}
/** The string a store handed back, trimmed, or null when there is nothing there. */
function text(raw) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw === 'number' || typeof raw === 'boolean')
        return String(raw);
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * Empty is absence, uniformly across this file.
 *
 * Since settings carry no defaults, "" and "never set" would otherwise be two
 * spellings of the same state, and a screen would have to know which one it was
 * looking at. There is one: a field somebody has cleared is a field that is
 * unset, and clearing one calls `clear()` rather than writing "".
 */
function stringType(options = {}) {
    const { maxLength = 512 } = options;
    return make('string', (raw) => {
        const value = text(raw);
        if (value === null)
            return undefined;
        return value.length <= maxLength ? value : undefined;
    }, (value) => value);
}
/**
 * Booleans, read leniently because the fleet has written them three ways:
 * `'true'`, `'1'` and — in HarborSentinel's SQLite — an INTEGER. Written one way.
 */
exports.boolType = make('bool', (raw) => {
    if (typeof raw === 'boolean')
        return raw;
    if (typeof raw === 'number')
        return raw !== 0;
    const value = text(raw);
    if (value === null)
        return undefined;
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on')
        return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off')
        return false;
    return undefined;
}, (value) => (value ? 'true' : 'false'));
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
function numeric(name, integral, options) {
    const { min, max } = options;
    return make(name, (raw) => {
        const asText = typeof raw === 'number' ? null : text(raw);
        const value = typeof raw === 'number' ? raw : asText === null ? NaN : Number(asText);
        if (!Number.isFinite(value))
            return undefined;
        if (integral && !Number.isInteger(value))
            return undefined;
        if (min !== undefined && value < min)
            return undefined;
        if (max !== undefined && value > max)
            return undefined;
        return value;
    }, (value) => String(value));
}
function intType(options = {}) {
    return numeric('int', true, options);
}
function numberType(options = {}) {
    return numeric('number', false, options);
}
/** A closed set of string values. Anything outside it falls through. */
function oneOf(values) {
    const allowed = new Set(values);
    return make(`oneOf(${values.join('|')})`, (raw) => {
        const value = text(raw);
        return value !== null && allowed.has(value) ? value : undefined;
    }, (value) => value);
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
exports.hostType = make('host', (raw) => {
    const value = text(raw);
    if (value === null)
        return undefined;
    if (/\s/.test(value) || value.includes('/') || value.includes('@'))
        return undefined;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
        return undefined;
    if (value.startsWith('['))
        return /^\[[0-9a-f:]+\]$/i.test(value) ? value : undefined;
    if (value.includes(':'))
        return undefined;
    return /^[a-z0-9._-]+$/i.test(value) ? value : undefined;
}, (value) => value);
exports.portType = make('port', (raw) => intType({ min: 1, max: 65535 }).parse(raw), (value) => String(value));
/**
 * An absolute URL. An unset backend URL is how both apps say "standalone, no PC
 * to talk to" — which is absence, not an empty string.
 */
function urlType(options = {}) {
    const { protocols = ['http:', 'https:'] } = options;
    return make('url', (raw) => {
        const value = text(raw);
        if (value === null)
            return undefined;
        if (host.URL === undefined)
            return undefined;
        let parsed;
        try {
            parsed = new host.URL(value);
        }
        catch {
            return undefined;
        }
        return protocols.includes(parsed.protocol) ? value.replace(/\/+$/, '') : undefined;
    }, (value) => value);
}
/**
 * Exactly nine digits, or nothing.
 *
 * The rejection matters more here than anywhere else in this file. A wrong MMSI
 * does not fail loudly — it silently stops own ship being suppressed from the
 * AIS proximity alarm, so the boat sets off its own alarm. Leaving it unset is
 * safe, because the alarm refuses to run at all without one; a half-typed
 * number is not.
 */
exports.mmsiType = make('mmsi', (raw) => {
    const value = text(raw);
    if (value === null)
        return undefined;
    return /^\d{9}$/.test(value) ? value : undefined;
}, (value) => value);
/**
 * A list, stored as JSON.
 *
 * One bad element invalidates the whole list rather than being dropped. A
 * partially-parsed list is worse than no list: OceanSentinel's log book records
 * whichever NMEA fields this array names, and silently recording fewer of them
 * than the navigator chose is a wrong log entry that nothing reports.
 */
function listType(item) {
    return make(`list(${item.name})`, (raw) => {
        let source = raw;
        if (typeof raw === 'string') {
            const value = text(raw);
            if (value === null)
                return undefined;
            try {
                source = JSON.parse(value);
            }
            catch {
                return undefined;
            }
        }
        if (!Array.isArray(source))
            return undefined;
        const out = [];
        for (const element of source) {
            const parsed = item.parse(element);
            if (parsed === undefined)
                return undefined;
            out.push(parsed);
        }
        return out;
    }, 
    /*
      The values, not their serialised forms. Mapping each element through
      `item.serialize` first produced an array of strings — `["1","2"]` for a list
      of numbers — which round-tripped only because `parse` is lenient about
      types. It also made an object element unrepresentable, which is how a list
      of log-book presets came to be declared as a list of strings.
    */
    (value) => JSON.stringify(value));
}
/**
 * An object with declared fields, for the few settings that are records rather
 * than scalars — OceanSentinel's log-book quick-tap presets, which are
 * `{ id, label, text }`.
 *
 * Every declared field must parse or the whole object is rejected, on the same
 * grounds as `listType`: a half-understood preset is a log entry that records
 * something other than what the navigator picked. Undeclared fields are dropped
 * rather than carried, so a value written by a newer build cannot smuggle
 * anything through an older one.
 */
function shapeType(name, fields) {
    return make(`shape(${name})`, (raw) => {
        let source = raw;
        if (typeof raw === 'string') {
            const value = text(raw);
            if (value === null)
                return undefined;
            try {
                source = JSON.parse(value);
            }
            catch {
                return undefined;
            }
        }
        if (source === null || typeof source !== 'object' || Array.isArray(source))
            return undefined;
        const out = {};
        for (const [field, type] of Object.entries(fields)) {
            const parsed = type.parse(source[field]);
            if (parsed === undefined)
                return undefined;
            out[field] = parsed;
        }
        return out;
    }, (value) => JSON.stringify(value));
}
