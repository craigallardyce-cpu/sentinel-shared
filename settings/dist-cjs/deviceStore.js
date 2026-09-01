"use strict";
/**
 * The device layer, backed by `localStorage`.
 *
 * Two things here are not obvious and both exist because of how the fleet's
 * settings got into their current state.
 *
 * **Everything is namespaced.** Values are written under `sentinel.<key>`, so
 * settings stop sharing a flat namespace with cached application data. Today
 * OceanSentinel's 68 `localStorage` keys mix preferences (`vhf_squelch_threshold`)
 * with cached records (`vessel_passages`, `vessel_logs`) and credentials
 * (`oauth_provider_token`), and nothing in the name distinguishes them — which is
 * most of why "68 settings" sounded like a bigger job than it is.
 *
 * **Legacy keys are read but never written.** A setting can declare where it
 * used to live per app, and this store falls back to those names when the
 * namespaced key is absent. That makes adopting the registry non-destructive by
 * construction: a device that upgrades keeps every value somebody had set,
 * without a migration having to run first and without this store quietly
 * rewriting a person's storage on a read.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PREFIX = void 0;
exports.createDeviceStore = createDeviceStore;
exports.createHostStore = createHostStore;
exports.DEFAULT_PREFIX = 'sentinel.';
function createDeviceStore(storage, options) {
    const { app, registry, prefix = exports.DEFAULT_PREFIX } = options;
    const listeners = new Set();
    const namespaced = (key) => `${prefix}${key}`;
    function legacyKeys(key) {
        let definition;
        try {
            definition = registry.get(key);
        }
        catch {
            return [];
        }
        return definition.legacy?.[app] ?? [];
    }
    /*
      Every call into Storage is guarded. `localStorage` is not merely absent in
      some environments — it throws on access in Safari private browsing and on
      write when a device is out of quota. A settings read is on the path to the
      first paint of both apps, so a throw here is a blank screen rather than a
      missing preference.
    */
    function read(key) {
        try {
            const value = storage.getItem(key);
            return value === null ? undefined : value;
        }
        catch {
            return undefined;
        }
    }
    return {
        scope: 'device',
        get(key) {
            const own = read(namespaced(key));
            if (own !== undefined)
                return own;
            // Most recent legacy name first, so an app that renamed a key twice
            // still finds the value a person most recently set.
            for (const legacy of legacyKeys(key)) {
                const value = read(legacy);
                if (value !== undefined)
                    return value;
            }
            return undefined;
        },
        set(key, raw) {
            try {
                storage.setItem(namespaced(key), raw);
            }
            catch {
                /* Out of quota or storage disabled. The in-memory value still applies for this session. */
            }
        },
        clear(key) {
            /*
              Clearing removes the legacy names too.
      
              Without this, "Clear override" would appear to do nothing for any setting
              that still had a pre-registry value: the namespaced key would go, the
              fallback would find the old one, and the override would come straight
              back. The value the person is looking at is the one being cleared,
              whichever name it happens to be stored under.
            */
            for (const name of [namespaced(key), ...legacyKeys(key)]) {
                try {
                    storage.removeItem(name);
                }
                catch {
                    /* As above: nothing useful to do, and not worth failing the clear. */
                }
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        notifyExternalChange() {
            for (const listener of listeners)
                listener();
        },
    };
}
/**
 * The host layer: settings belonging to the machine running the backend, shared
 * by every device pointed at it.
 *
 * The same shape as the device store and deliberately duller — no legacy key
 * names, because a server never had a `localStorage` to inherit them from, and
 * no per-app lookup, because a host runs one backend. What it does have is a
 * different answer from the device layer, which is the entire point: a PC's
 * gateway address and a phone's are both correct, and HarborSentinel currently
 * has to strip the phone's out of its payload to stop one overwriting the other.
 *
 * The storage is injected, so a server backs this with a table and this package
 * still knows nothing about SQLite.
 */
function createHostStore(storage, options = {}) {
    const { prefix = exports.DEFAULT_PREFIX } = options;
    const listeners = new Set();
    return {
        scope: 'host',
        get(key) {
            try {
                const value = storage.getItem(`${prefix}${key}`);
                return value === null ? undefined : value;
            }
            catch {
                return undefined;
            }
        },
        set(key, raw) {
            try {
                storage.setItem(`${prefix}${key}`, raw);
            }
            catch {
                /* Read-only or full; the in-memory value still applies for this session. */
            }
        },
        clear(key) {
            try {
                storage.removeItem(`${prefix}${key}`);
            }
            catch {
                /* As above. */
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        notifyExternalChange() {
            for (const listener of listeners)
                listener();
        },
    };
}
