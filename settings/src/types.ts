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
 * Who a value belongs to.
 *
 * Deliberately not "where it is stored": the same setting can legitimately be
 * held at more than one layer at once. The NMEA gateway is the case that forced
 * this — the boat has a multiplexer at a fixed address AND a phone in the cabin
 * reaches it through the PC, and both of those are true simultaneously. Picking
 * a single store for it is what produced the workaround in HarborSentinel that
 * strips the host and port from its payload on Android so a phone cannot
 * overwrite the PC's hardware settings.
 */
export type Scope = 'account' | 'vessel' | 'host' | 'device';

/**
 * Broadest first, narrowest last. Resolution walks this order and keeps the LAST
 * layer that answered, so a device override beats the boat, which beats the
 * account. Changing this array changes what wins; nothing else encodes it.
 */
export const SCOPE_ORDER: readonly Scope[] = ['account', 'vessel', 'host', 'device'];

/** Where a resolved value actually came from. `default` means no layer held one. */
export type Source = Scope | 'default';

/**
 * The apps that consume this package. Used only to look up where a setting used
 * to live before it had a declaration, since the legacy key names differ per app
 * (`harbor_sentinel_keep_awake` and `ocean_sentinel_keep_awake` are one setting).
 */
export type AppName = 'harbor' | 'ocean' | 'vessel-keeper';

/**
 * The few facts about the running device that a default is allowed to depend on.
 *
 * Kept to exactly one field on purpose. A default that varies by platform is a
 * real requirement — OceanSentinel's speaker monitoring is off on phones because
 * the handset's own microphone is usually the input and playing it back feeds
 * the mic into itself — but it is also the shape that produced three different
 * NMEA gateway defaults inside one app. One narrow, declared axis is the most
 * this should ever grow.
 */
export interface PlatformContext {
  /** True in a Capacitor native shell (phone or tablet), false on desktop/web. */
  native: boolean;
}

/**
 * How a stored string becomes a usable value, and back.
 *
 * `parse` returning `undefined` is the most important behaviour in this package.
 * It means "this layer has nothing I can trust", and resolution treats that
 * exactly like an absent value: it falls through to the next layer, and
 * ultimately to the declared default. The alternative is what the fleet does
 * today — `parseInt(localStorage.getItem('x') || '5', 10)` hands every consumer
 * a `NaN` when the stored value is garbage, and nothing notices until a number
 * that cannot be compared reaches an alarm threshold.
 */
export interface SettingType<T> {
  /** For error messages and the drift checker. */
  readonly name: string;
  /** Anything unusable — wrong shape, out of range, corrupt — becomes `undefined`. */
  parse(raw: unknown): T | undefined;
  /** The string form written to a store. Must round-trip through `parse`. */
  serialize(value: T): string;
}

/** A setting as it is authored, before the registry attaches its key. */
export interface SettingSpec<T> {
  /**
   * The layers allowed to hold this setting, in any order. A write to a scope
   * that is not listed is refused — this is what stops a per-boat fact from
   * quietly becoming a per-phone one, which is how the fleet ended up with a
   * boat name that differs between two apps on the same account.
   */
  readonly scopes: readonly Scope[];
  readonly type: SettingType<T>;
  /**
   * The one place a literal for this setting is allowed to appear. A function is
   * permitted only for genuinely platform-dependent defaults; the registry
   * evaluates both branches at construction and refuses either if it does not
   * parse.
   */
  readonly default: T | ((platform: PlatformContext) => T);
  /** Human label, as it appears in the settings dialog. */
  readonly label: string;
  readonly description?: string;
  /**
   * Where this setting lived before it was declared, per app, most recent first.
   * The device store reads these when the namespaced key is absent, so adopting
   * the registry never loses a value somebody already set. Migration proper —
   * copying them forward and dropping them — is a later, explicit step.
   */
  readonly legacy?: Readonly<Partial<Record<AppName, readonly string[]>>>;
}

/** A setting once the registry has attached its key. */
export interface SettingDefinition<T> extends SettingSpec<T> {
  readonly key: string;
}

/** The value type a spec carries, recovered for typed `get`/`set`. */
export type SettingValue<S> = S extends SettingSpec<infer T> ? T : never;

/**
 * One layer's storage.
 *
 * `get` is deliberately synchronous, and that constraint comes from the consuming
 * code rather than from taste: every settings read in OceanSentinel is a
 * `useState(() => localStorage.getItem(...))` initialiser that assumes the value
 * is present on the first render. A store that can only answer asynchronously —
 * the cloud layers, when they land — must return `undefined` until it has
 * loaded and then fire its subscription, so the first paint shows the declared
 * default rather than a blank field, and the real value promotes in behind it.
 *
 * `set` and `clear` may be async, but must update whatever `get` reads from
 * BEFORE the promise settles. A write that is not visible to the next read is
 * how a settings screen appears not to save.
 */
export interface ScopeStore {
  readonly scope: Scope;
  /** The raw stored string, or `undefined` when this layer holds nothing. */
  get(key: string): string | undefined;
  set(key: string, raw: string): void | Promise<void>;
  clear(key: string): void | Promise<void>;
  /** Called when the layer changes underneath us — another tab, another device. */
  subscribe?(listener: () => void): () => void;
}
