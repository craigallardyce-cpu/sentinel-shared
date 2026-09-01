/**
 * Carrying pre-registry values up to the layer they belong to.
 *
 * The device store reads a setting's old `localStorage` key when the namespaced
 * one is absent, which makes adopting the registry free — but only for settings
 * that declare a `device` scope, because a store is never consulted for a scope
 * its setting does not declare. Everything held at `account` or `vessel` has its
 * old value sitting in `localStorage` where nothing will ever read it.
 *
 * That is most of what OceanSentinel keeps: the VHF retention policy, the log
 * book's interval and its field list, the transcription model, the boat's name,
 * MMSI and type. Adopting without this step would resolve all of them to their
 * defaults — which, since almost nothing has one, means losing them.
 *
 * Run once per device, and record that it ran.
 */
import { defaultFor } from './registry.js';
import { DEFAULT_PREFIX } from './deviceStore.js';
/**
 * Versioned, because what the migration does has changed.
 *
 * v1 skipped device-scoped settings: the device store reads their old key names
 * in place, so copying them looked like making a second copy of a value that was
 * being read fine. That was true right up until the old names are deleted, at
 * which point every one of them -- brightness, keep awake, the backend address,
 * the gateway, the VHF tuning -- would silently revert to its default on every
 * install that had ever set it.
 *
 * Bumping the marker re-runs the whole thing, which is safe: a setting a layer
 * already holds is skipped.
 */
export const DEFAULT_MARKER_KEY = 'sentinel.migrated.legacy.v2';
/**
 * **Call this only after every cloud layer has finished `load()`.**
 *
 * A setting reads as unconfigured while its layer is still loading, and this
 * function writes into anything unconfigured. Run it too early and it would push
 * a stale local value over whatever the account already holds — turning a
 * migration into the data loss it exists to prevent. The `writableScopes` list
 * is the second half of that guard: a scope with no store attached is not a
 * place to migrate into.
 */
export async function migrateLegacyKeys(options) {
    const { registry, settings, app, storage, writableScopes, platform = { native: false }, devicePrefix = DEFAULT_PREFIX, markerKey = DEFAULT_MARKER_KEY, dryRun = false, } = options;
    const result = { migrated: {}, unparseable: [], alreadyDone: false };
    try {
        if (storage.getItem(markerKey)) {
            result.alreadyDone = true;
            return result;
        }
    }
    catch {
        /* Storage unreadable: attempt the migration rather than skip it. Writing a
           value that is already there is harmless; losing one is not. */
    }
    for (const definition of registry.all()) {
        const legacyKeys = definition.legacy?.[app];
        if (!legacyKeys || legacyKeys.length === 0)
            continue;
        // Narrowest declared scope that something can actually be written to.
        const target = [...writableScopes].reverse().find((scope) => definition.scopes.includes(scope));
        if (!target)
            continue;
        /*
          A device-scoped setting needs a different question asked.
    
          Its legacy key is read IN PLACE by the device store, so the resolution
          chain reports it as configured whether or not it has ever been written
          under the namespaced name. Asking the chain would therefore skip it -- and
          it would keep skipping it right up until the old names are deleted, at
          which point the value disappears. So the storage is asked directly: is
          there a namespaced value yet?
        */
        if (target === 'device') {
            let own = null;
            try {
                own = storage.getItem(`${devicePrefix}${definition.key}`);
            }
            catch {
                own = null;
            }
            if (own !== null)
                continue;
        }
        else if (settings.source(definition.key) !== 'unset' && settings.source(definition.key) !== 'default') {
            /*
              Skip only when a real LAYER already holds a value -- not when the declared
              default is answering.
      
              This was `isConfigured`, which is true for both, and that silently dropped
              the legacy value of any setting that has a default. It went unnoticed
              while every defaulted setting happened to be device-scoped and therefore
              never migrated; the first account-scoped one with a default -- the log
              book's quick-tap presets -- would have lost a navigator's edited list on
              upgrade and shown them the starter list instead.
            */
            continue;
        }
        let raw = null;
        for (const legacy of legacyKeys) {
            try {
                raw = storage.getItem(legacy);
            }
            catch {
                raw = null;
            }
            if (raw !== null)
                break;
        }
        if (raw === null)
            continue;
        const parsed = definition.type.parse(raw);
        if (parsed === undefined) {
            result.unparseable.push(definition.key);
            continue;
        }
        /*
          A legacy value identical to the declared default is not worth writing. It
          would turn "nobody has said" into "somebody chose this", which is a real
          difference: the settings screen shows one as an empty field and the other
          as an answer.
        */
        const fallback = defaultFor(definition, platform);
        if (fallback !== undefined && definition.type.serialize(parsed) === definition.type.serialize(fallback)) {
            continue;
        }
        if (dryRun) {
            result.migrated[definition.key] = target;
            continue;
        }
        try {
            await settings.set(definition.key, parsed, { scope: target });
            result.migrated[definition.key] = target;
        }
        catch {
            /*
              Offline, signed out, or refused. Deliberately not marked done below only
              if nothing at all succeeded would be wrong too -- so the marker is
              written regardless and the old keys are left in place for a release, which
              is what makes a second attempt possible rather than necessary.
            */
        }
    }
    if (!dryRun) {
        try {
            storage.setItem(markerKey, new Date().toISOString());
        }
        catch {
            /* Unmarked: it will run again next boot and be a no-op for anything that
               landed, because a configured setting is skipped. */
        }
    }
    return result;
}
