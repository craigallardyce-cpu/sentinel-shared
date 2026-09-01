/**
 * The registry: the set of settings that exist, and the checks that a
 * declaration is coherent before anything tries to use it.
 *
 * Every check here fails at construction — which means at import, which means at
 * the app's first render and in CI, rather than on a boat. That placement is the
 * whole value of the file. A default that does not satisfy its own type is
 * exactly the class of mistake that shipped a home LAN address as
 * OceanSentinel's NMEA gateway default, and it is caught here in one line.
 */
import { SCOPE_ORDER } from './types.js';
/**
 * Dotted lower-case segments. A flat namespace with no grammar is how
 * `night_brightness`, `hangover_time` and `vessel_passages` — a preference, a
 * tuning constant and a cached list of passages — ended up indistinguishable
 * from each other in the same store.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
/** Both platform branches, so a platform-dependent default is checked in full. */
const PLATFORMS = [{ native: false }, { native: true }];
/** Authoring helper. Identity at runtime; it exists to anchor type inference and JSDoc. */
export function defineSetting(spec) {
    return spec;
}
/**
 * Resolve a declared default for a platform, or `undefined` when the setting
 * declares none — which is almost all of them. See `SettingSpec.default`.
 */
export function defaultFor(spec, platform) {
    if (spec.default === undefined)
        return undefined;
    return typeof spec.default === 'function' ? spec.default(platform) : spec.default;
}
export function createRegistry(specs) {
    const byKey = new Map();
    for (const [key, spec] of Object.entries(specs)) {
        if (!KEY_PATTERN.test(key)) {
            throw new Error(`Settings: "${key}" is not a valid key (lower-case dotted segments, e.g. nmea.gateway.host).`);
        }
        if (byKey.has(key)) {
            throw new Error(`Settings: "${key}" is declared twice.`);
        }
        if (spec.scopes.length === 0) {
            throw new Error(`Settings: "${key}" declares no scopes, so nothing could ever hold it.`);
        }
        const seen = new Set();
        for (const scope of spec.scopes) {
            if (!SCOPE_ORDER.includes(scope)) {
                throw new Error(`Settings: "${key}" declares unknown scope "${scope}".`);
            }
            if (seen.has(scope)) {
                throw new Error(`Settings: "${key}" declares scope "${scope}" twice.`);
            }
            seen.add(scope);
        }
        /*
          A switch has to be either on or off, so a toggle must say which.
    
          Every other kind of setting is the owner's to supply and stays `unset`
          until they do. Enforcing that here, rather than trusting each declaration
          to remember, is what keeps a well-meaning default from creeping back in
          one setting at a time.
        */
        if (spec.type.name === 'bool' && spec.default === undefined) {
            throw new Error(`Settings: "${key}" is a toggle, so it must declare a default of true or false.`);
        }
        /*
          A declared default must satisfy its own type.
    
          Cheap to check and it catches the exact shape of two bugs already in the
          tree: a port declared as a string, and an address that is not one. Both
          branches of a platform-dependent default are checked, because the one that
          only runs on a phone is the one nobody exercises before release.
        */
        if (spec.default !== undefined) {
            for (const platform of PLATFORMS) {
                const value = defaultFor(spec, platform);
                if (spec.type.parse(value) === undefined) {
                    const where = typeof spec.default === 'function' ? ` (native: ${platform.native})` : '';
                    throw new Error(`Settings: the default for "${key}"${where} is not a valid ${spec.type.name}: ${JSON.stringify(value)}.`);
                }
                if (typeof spec.default !== 'function')
                    break;
            }
        }
        byKey.set(key, { ...spec, key });
    }
    return {
        specs,
        has: (key) => byKey.has(key),
        get(key) {
            const definition = byKey.get(key);
            if (!definition)
                throw new Error(`Settings: "${key}" is not a declared setting.`);
            return definition;
        },
        keys: () => [...byKey.keys()],
        all: () => [...byKey.values()],
    };
}
