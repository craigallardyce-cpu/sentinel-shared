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
export const DEFAULT_MARKER_KEY = 'sentinel.migrated.legacy';
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
    const { registry, settings, app, storage, writableScopes, platform = { native: false }, markerKey = DEFAULT_MARKER_KEY, dryRun = false, } = options;
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
        /*
          Settings the device store can already reach are left alone. Migrating them
          would mean writing a namespaced copy of a value that is being read fine,
          and then having two.
        */
        if (definition.scopes.includes('device'))
            continue;
        // Narrowest declared scope that something can actually be written to.
        const target = [...writableScopes].reverse().find((scope) => definition.scopes.includes(scope));
        if (!target)
            continue;
        if (settings.isConfigured(definition.key))
            continue;
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
