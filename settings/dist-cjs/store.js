"use strict";
/**
 * The resolution chain.
 *
 * Reading a setting walks the layers from broadest to narrowest and keeps the
 * last one that answered with something it could parse. Writing names a layer
 * explicitly and is refused if the setting does not declare it.
 *
 * The asymmetry between the two is deliberate and worth stating, because it is
 * the property the rest of the design rests on:
 *
 *   Reads are lenient.  A layer holding a value this build cannot understand is
 *                       skipped, not fatal. Something always resolves, and the
 *                       floor is the declared default.
 *   Writes are strict.  A value that does not parse, or a scope the setting does
 *                       not declare, throws. Nothing gets into a store that a
 *                       later read would have to skip.
 *
 * And the shape that cannot exist here: there is no way to write "all the
 * settings" at once. `set` takes one key. HarborSentinel's `POST /config` built
 * one UPDATE from the whole request body, so every field a caller omitted was
 * written as null — it reset the NMEA gateway, nulled own MMSI and switched the
 * AIS proximity alarm off, with no error, because from the database's point of
 * view the write succeeded. That bug is not fixed here so much as made
 * unspellable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSettingsStore = createSettingsStore;
const types_js_1 = require("./types.js");
const registry_js_1 = require("./registry.js");
const DESKTOP = { native: false };
function createSettingsStore(options) {
    const { registry, stores, platform = DESKTOP } = options;
    const byScope = new Map();
    for (const store of stores) {
        if (byScope.has(store.scope)) {
            throw new Error(`Settings: two stores were supplied for the "${store.scope}" scope.`);
        }
        byScope.set(store.scope, store);
    }
    const listeners = new Set();
    const notify = () => {
        for (const listener of listeners)
            listener();
    };
    for (const store of stores)
        store.subscribe?.(notify);
    function storeFor(key, scope) {
        const definition = registry.get(key);
        if (!definition.scopes.includes(scope)) {
            throw new Error(`Settings: "${key}" cannot be held at the "${scope}" scope (it declares ${definition.scopes.join(', ')}).`);
        }
        const store = byScope.get(scope);
        if (!store) {
            throw new Error(`Settings: no store is attached for the "${scope}" scope.`);
        }
        return store;
    }
    function readAt(key, scope) {
        const definition = registry.get(key);
        if (!definition.scopes.includes(scope))
            return undefined;
        const store = byScope.get(scope);
        if (!store)
            return undefined;
        let raw;
        try {
            raw = store.get(key);
        }
        catch {
            /*
              A layer that throws on read is treated as empty rather than allowed to
              break the read. localStorage throws outright in Safari private mode and
              when a device is out of quota, and a settings screen that cannot open is
              a worse failure than one showing declared defaults.
            */
            return undefined;
        }
        if (raw === undefined || raw === null)
            return undefined;
        return definition.type.parse(raw);
    }
    function resolveKey(key) {
        const definition = registry.get(key);
        let value = (0, registry_js_1.defaultFor)(definition, platform);
        let source = 'default';
        // Broadest first; the last layer to answer wins.
        for (const scope of types_js_1.SCOPE_ORDER) {
            const parsed = readAt(key, scope);
            if (parsed !== undefined) {
                value = parsed;
                source = scope;
            }
        }
        return { value, source };
    }
    return {
        get(key) {
            return resolveKey(key).value;
        },
        resolve(key) {
            return resolveKey(key);
        },
        source(key) {
            return resolveKey(key).source;
        },
        isSetAt(key, scope) {
            return readAt(key, scope) !== undefined;
        },
        scopesFor(key) {
            const declared = registry.get(key).scopes;
            return types_js_1.SCOPE_ORDER.filter((scope) => declared.includes(scope));
        },
        async set(key, value, { scope }) {
            const definition = registry.get(key);
            const store = storeFor(key, scope);
            const parsed = definition.type.parse(value);
            if (parsed === undefined) {
                throw new Error(`Settings: ${JSON.stringify(value)} is not a valid ${definition.type.name} for "${key}".`);
            }
            await store.set(key, definition.type.serialize(parsed));
            notify();
        },
        async clear(key, scope) {
            const store = storeFor(key, scope);
            await store.clear(key);
            notify();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        snapshot() {
            const out = {};
            for (const definition of registry.all())
                out[definition.key] = resolveKey(definition.key).value;
            return out;
        },
    };
}
