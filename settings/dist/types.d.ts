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
export declare const SCOPE_ORDER: readonly Scope[];
/**
 * Where a resolved value came from.
 *
 * `default` is rare on purpose: only on/off toggles declare one, because a
 * switch has to be either on or off. Everything else resolves to `unset` until
 * somebody sets it — the fleet does not guess at a boat's MMSI, its gateway
 * address or its alarm limits.
 */
export type Source = Scope | 'default' | 'unset';
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
     * Omitted for almost everything, and that is the design.
     *
     * A default is a value nobody chose, and this fleet has been bitten by every
     * one it shipped: a home LAN address as the NMEA gateway, a specific real boat
     * as the boat name, one operator's relay endpoint as a hosted address. Each
     * looked like a helpful head start and each was silently wrong for every
     * install but one — and invisible, because a pre-filled field reads as a
     * configured field.
     *
     * So a value the owner is the authority on has no default. It stays `unset`
     * until somebody sets it, which is a state the UI can show and act on. Use
     * `placeholder` to tell them what shape of value belongs there.
     *
     * The exception, enforced by the registry, is an on/off toggle: a switch has
     * to be either on or off, so a `bool` setting MUST declare a default. A
     * function is permitted only for genuinely platform-dependent ones; the
     * registry evaluates both branches at construction and refuses either if it
     * does not parse.
     */
    readonly default?: T | ((platform: PlatformContext) => T);
    /**
     * Shown greyed out in an empty field — `e.g. 10.10.10.1`. Never returned by
     * `get()` and never written anywhere. This is what is left of the deleted
     * defaults: the useful half (telling somebody what goes here) without the
     * harmful half (acting on a guess they never made).
     */
    readonly placeholder?: string;
    /** Human label, as it appears in the settings dialog. */
    readonly label: string;
    readonly description?: string;
    /**
     * Written by a machine, never typed by anybody.
     *
     * Everything else here is a question put to the owner, which is why an
     * un-defaulted setting must offer a placeholder: it will be shown as an empty
     * field and has to say what belongs in it. A managed setting has no field —
     * the boat PC publishes its pairing token and every device reads it — so a
     * placeholder would describe a box that does not exist.
     *
     * It still carries a label and description, because it is a real value that
     * appears in diagnostics and in whatever eventually lists what a device knows.
     */
    readonly managed?: boolean;
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
