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

import { SCOPE_ORDER } from './types.js';
import { defaultFor } from './registry.js';
import type { AnySpec, Registry } from './registry.js';
import type { PlatformContext, Scope, ScopeStore, SettingValue, Source } from './types.js';

export interface SettingsStoreOptions<D extends Record<string, AnySpec>> {
  registry: Registry<D>;
  /** One store per layer. Layers with no store simply never answer. */
  stores: readonly ScopeStore[];
  /** Defaults to desktop. Pass `{ native: Capacitor.isNativePlatform() }`. */
  platform?: PlatformContext;
}

/**
 * What a key resolves to.
 *
 * A spec that declares a default cannot resolve to nothing, so its type does not
 * include `undefined` and callers need no fallback. Everything else can be
 * `unset`, and says so in its type.
 */
export type Resolvable<S> = S extends { default: unknown } ? SettingValue<S> : SettingValue<S> | undefined;

export interface Resolved<T> {
  /** `undefined` when nothing has been configured — see `source`. */
  value: T;
  /**
   * Which layer answered. `default` only ever appears for an on/off toggle;
   * `unset` means nobody has supplied a value yet, which is a normal state and
   * the one a settings screen should show as an empty field.
   */
  source: Source;
}

export interface SettingsStore<D extends Record<string, AnySpec>> {
  /**
   * The resolved value, or `undefined` when nothing has been configured. Never
   * throws for a declared key.
   *
   * Handling `undefined` is deliberate friction: it is the compiler asking what
   * the app should do before an owner has told it their MMSI or their gateway
   * address, instead of letting a guessed value flow silently into an alarm.
   */
  get<K extends keyof D & string>(key: K): Resolvable<D[K]>;
  /** The resolved value plus where it came from, for "set on this device / from the boat". */
  resolve<K extends keyof D & string>(key: K): Resolved<Resolvable<D[K]>>;
  source(key: string): Source;
  /** False while a setting is still `unset`. */
  isConfigured(key: string): boolean;
  /** True when this layer holds a usable value — i.e. there is an override to clear. */
  isSetAt(key: string, scope: Scope): boolean;
  /** The scopes this setting may be written to, narrowest last. */
  scopesFor(key: string): readonly Scope[];
  set<K extends keyof D & string>(key: K, value: SettingValue<D[K]>, options: { scope: Scope }): Promise<void>;
  clear(key: string, scope: Scope): Promise<void>;
  /** Fires when any attached layer changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Every declared setting, resolved. For diagnostics and support bundles. */
  snapshot(): Record<string, unknown>;
  /**
   * Every setting currently answered by this layer.
   *
   * What a settings screen needs to say "3 values are set on this device" — and
   * what somebody needs in order to know whether the screen they are looking at
   * is showing them the boat's answers or their own.
   */
  keysSetAt(scope: Scope): string[];
}

const DESKTOP: PlatformContext = { native: false };

export function createSettingsStore<D extends Record<string, AnySpec>>(
  options: SettingsStoreOptions<D>
): SettingsStore<D> {
  const { registry, stores, platform = DESKTOP } = options;

  const byScope = new Map<Scope, ScopeStore>();
  for (const store of stores) {
    if (byScope.has(store.scope)) {
      throw new Error(`Settings: two stores were supplied for the "${store.scope}" scope.`);
    }
    byScope.set(store.scope, store);
  }

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  for (const store of stores) store.subscribe?.(notify);

  function storeFor(key: string, scope: Scope): ScopeStore {
    const definition = registry.get(key);
    if (!definition.scopes.includes(scope)) {
      throw new Error(
        `Settings: "${key}" cannot be held at the "${scope}" scope (it declares ${definition.scopes.join(', ')}).`
      );
    }
    const store = byScope.get(scope);
    if (!store) {
      throw new Error(`Settings: no store is attached for the "${scope}" scope.`);
    }
    return store;
  }

  function readAt(key: string, scope: Scope): unknown {
    const definition = registry.get(key);
    if (!definition.scopes.includes(scope)) return undefined;
    const store = byScope.get(scope);
    if (!store) return undefined;
    let raw: string | undefined;
    try {
      raw = store.get(key);
    } catch {
      /*
        A layer that throws on read is treated as empty rather than allowed to
        break the read. localStorage throws outright in Safari private mode and
        when a device is out of quota, and a settings screen that cannot open is
        a worse failure than one showing declared defaults.
      */
      return undefined;
    }
    if (raw === undefined || raw === null) return undefined;
    return definition.type.parse(raw);
  }

  function resolveKey(key: string): Resolved<unknown> {
    const definition = registry.get(key);
    let value: unknown = defaultFor(definition, platform);
    // Only toggles declare a default, so almost everything starts here.
    let source: Source = value === undefined ? 'unset' : 'default';

    // Broadest first; the last layer to answer wins.
    for (const scope of SCOPE_ORDER) {
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
      return resolveKey(key).value as Resolvable<D[typeof key]>;
    },

    resolve(key) {
      return resolveKey(key) as Resolved<Resolvable<D[typeof key]>>;
    },

    source(key) {
      return resolveKey(key).source;
    },

    isConfigured(key) {
      return resolveKey(key).source !== 'unset';
    },

    isSetAt(key, scope) {
      return readAt(key, scope) !== undefined;
    },

    scopesFor(key) {
      const declared = registry.get(key).scopes;
      return SCOPE_ORDER.filter((scope) => declared.includes(scope));
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

    keysSetAt(scope) {
      return registry
        .all()
        .filter((definition) => readAt(definition.key, scope) !== undefined)
        .map((definition) => definition.key);
    },

    snapshot() {
      const out: Record<string, unknown> = {};
      for (const definition of registry.all()) out[definition.key] = resolveKey(definition.key).value;
      return out;
    },
  };
}
