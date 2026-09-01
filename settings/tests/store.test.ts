import { describe, expect, it, vi } from 'vitest';
import { createRegistry, defineSetting } from '../src/registry.js';
import { createSettingsStore } from '../src/store.js';
import { boolType, hostType, intType, portType } from '../src/valueTypes.js';
import type { Scope, ScopeStore } from '../src/types.js';

/** A scope store backed by a Map, so a test can put a value at any layer. */
function memoryStore(scope: Scope, seed: Record<string, string> = {}): ScopeStore & { raw: Map<string, string> } {
  const raw = new Map(Object.entries(seed));
  const listeners = new Set<() => void>();
  return {
    scope,
    raw,
    get: (key) => raw.get(key),
    set: (key, value) => {
      raw.set(key, value);
      for (const listener of listeners) listener();
    },
    clear: (key) => {
      raw.delete(key);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const registry = createRegistry({
  'nmea.gateway.host': defineSetting({
    scopes: ['vessel', 'host', 'device'],
    type: hostType,
    label: 'NMEA gateway address',
  }),
  'nmea.gateway.port': defineSetting({
    scopes: ['vessel', 'host', 'device'],
    type: portType,
    label: 'NMEA gateway port',
  }),
  'vessel.name': defineSetting({
    scopes: ['vessel'],
    type: intType(),
    label: 'unused numeric, kept simple for scope tests',
  }),
  'display.keep_awake': defineSetting({
    scopes: ['device'],
    type: boolType,
    default: false,
    label: 'Keep awake',
  }),
});

describe('resolution', () => {
  it('reports unset when no layer answers and nothing declared a default', () => {
    const settings = createSettingsStore({ registry, stores: [] });
    expect(settings.get('nmea.gateway.host')).toBeUndefined();
    expect(settings.source('nmea.gateway.host')).toBe('unset');
    expect(settings.isConfigured('nmea.gateway.host')).toBe(false);
  });

  it('falls to the declared default where there is one', () => {
    const settings = createSettingsStore({ registry, stores: [] });
    expect(settings.resolve('display.keep_awake')).toEqual({ value: false, source: 'default' });
    expect(settings.isConfigured('display.keep_awake')).toBe(true);
  });

  it('lets the narrowest layer win', () => {
    const settings = createSettingsStore({
      registry,
      stores: [
        memoryStore('vessel', { 'nmea.gateway.host': '10.10.10.1' }),
        memoryStore('device', { 'nmea.gateway.host': '127.0.0.1' }),
      ],
    });
    expect(settings.resolve('nmea.gateway.host')).toEqual({ value: '127.0.0.1', source: 'device' });
  });

  it('is the worked example from the proposal: the phone overrides, the PC does not', () => {
    const vessel = { 'nmea.gateway.host': '10.10.10.1', 'nmea.gateway.port': '11102' };

    const phone = createSettingsStore({
      registry,
      stores: [
        memoryStore('vessel', vessel),
        memoryStore('device', { 'nmea.gateway.host': '127.0.0.1', 'nmea.gateway.port': '10110' }),
      ],
    });
    const pc = createSettingsStore({ registry, stores: [memoryStore('vessel', vessel), memoryStore('device')] });

    expect(phone.resolve('nmea.gateway.host')).toEqual({ value: '127.0.0.1', source: 'device' });
    expect(phone.resolve('nmea.gateway.port')).toEqual({ value: 10110, source: 'device' });
    // The phone writing its own layer leaves the PC exactly where it was, which is
    // what makes HarborSentinel's Android field-stripping unnecessary.
    expect(pc.resolve('nmea.gateway.host')).toEqual({ value: '10.10.10.1', source: 'vessel' });
  });

  it('skips a layer holding something it cannot parse, instead of poisoning the read', () => {
    const settings = createSettingsStore({
      registry,
      stores: [
        memoryStore('vessel', { 'nmea.gateway.port': '11102' }),
        memoryStore('device', { 'nmea.gateway.port': 'not a port' }),
      ],
    });
    expect(settings.resolve('nmea.gateway.port')).toEqual({ value: 11102, source: 'vessel' });
  });

  it('reports unset when the only layer holding a value holds an unusable one', () => {
    const settings = createSettingsStore({
      registry,
      stores: [memoryStore('device', { 'nmea.gateway.port': 'not a port' })],
    });
    expect(settings.resolve('nmea.gateway.port')).toEqual({ value: undefined, source: 'unset' });
  });

  it('ignores a layer the setting does not declare, even if a store holds a value there', () => {
    const account = memoryStore('account', { 'display.keep_awake': 'true' });
    const settings = createSettingsStore({ registry, stores: [account] });
    expect(settings.get('display.keep_awake')).toBe(false);
    expect(settings.source('display.keep_awake')).toBe('default');
  });

  it('treats a store that throws on read as empty', () => {
    // localStorage throws outright in Safari private browsing; a settings screen
    // that cannot open is worse than one showing declared defaults.
    const broken: ScopeStore = {
      scope: 'device',
      get() {
        throw new Error('SecurityError');
      },
      set() {},
      clear() {},
    };
    const settings = createSettingsStore({ registry, stores: [broken] });
    expect(settings.get('nmea.gateway.host')).toBeUndefined();
    expect(settings.get('display.keep_awake')).toBe(false);
  });

  it('refuses two stores for one scope', () => {
    expect(() =>
      createSettingsStore({ registry, stores: [memoryStore('device'), memoryStore('device')] })
    ).toThrow(/two stores/);
  });
});

describe('writing', () => {
  it('writes to the named layer only', async () => {
    const vessel = memoryStore('vessel');
    const device = memoryStore('device');
    const settings = createSettingsStore({ registry, stores: [vessel, device] });

    await settings.set('nmea.gateway.host', '127.0.0.1', { scope: 'device' });

    expect(device.raw.get('nmea.gateway.host')).toBe('127.0.0.1');
    expect(vessel.raw.has('nmea.gateway.host')).toBe(false);
  });

  it('refuses a scope the setting does not declare', async () => {
    const settings = createSettingsStore({ registry, stores: [memoryStore('device'), memoryStore('vessel')] });
    // This is what stops a per-boat fact becoming a per-phone one.
    await expect(settings.set('vessel.name', 2, { scope: 'device' })).rejects.toThrow(/cannot be held at the "device"/);
  });

  it('refuses a value that does not parse', async () => {
    const settings = createSettingsStore({ registry, stores: [memoryStore('device')] });
    await expect(settings.set('nmea.gateway.port', 0, { scope: 'device' })).rejects.toThrow(/not a valid port/);
  });

  it('refuses a scope with no store attached', async () => {
    const settings = createSettingsStore({ registry, stores: [memoryStore('device')] });
    await expect(settings.set('nmea.gateway.host', '10.0.0.1', { scope: 'vessel' })).rejects.toThrow(
      /no store is attached/
    );
  });

  it('has no way to write more than one key, so an omitted field cannot clear anything', () => {
    const settings = createSettingsStore({ registry, stores: [memoryStore('device')] });
    // The shape that produced the POST /config data loss does not exist on this
    // interface: there is no setAll, no patch, and no object-shaped write.
    const surface = Object.keys(settings);
    expect(surface).not.toContain('setAll');
    expect(surface).not.toContain('replace');
    expect(settings.set.length).toBe(3);
  });
});

describe('clearing an override', () => {
  it('falls back to the next layer', async () => {
    const device = memoryStore('device', { 'nmea.gateway.host': '127.0.0.1' });
    const settings = createSettingsStore({
      registry,
      stores: [memoryStore('vessel', { 'nmea.gateway.host': '10.10.10.1' }), device],
    });

    expect(settings.source('nmea.gateway.host')).toBe('device');
    await settings.clear('nmea.gateway.host', 'device');
    expect(settings.resolve('nmea.gateway.host')).toEqual({ value: '10.10.10.1', source: 'vessel' });
  });

  it('reports which layers actually hold a value, for the Clear override affordance', () => {
    const settings = createSettingsStore({
      registry,
      stores: [
        memoryStore('vessel', { 'nmea.gateway.host': '10.10.10.1' }),
        memoryStore('device', { 'nmea.gateway.host': '127.0.0.1' }),
      ],
    });
    expect(settings.isSetAt('nmea.gateway.host', 'device')).toBe(true);
    expect(settings.isSetAt('nmea.gateway.host', 'vessel')).toBe(true);
    expect(settings.isSetAt('nmea.gateway.port', 'device')).toBe(false);
  });
});

describe('the rest of the surface', () => {
  it('lists the scopes for a setting narrowest last, whatever order they were declared in', () => {
    const settings = createSettingsStore({ registry, stores: [] });
    expect(settings.scopesFor('nmea.gateway.host')).toEqual(['vessel', 'host', 'device']);
  });

  it('notifies on a write and on an external change', async () => {
    const device = memoryStore('device');
    const settings = createSettingsStore({ registry, stores: [device] });
    const listener = vi.fn();
    const unsubscribe = settings.subscribe(listener);

    await settings.set('display.keep_awake', true, { scope: 'device' });
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    await settings.set('display.keep_awake', false, { scope: 'device' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('snapshots every declared setting, resolved', () => {
    const settings = createSettingsStore({
      registry,
      stores: [memoryStore('device', { 'display.keep_awake': 'true' })],
    });
    expect(settings.snapshot()).toEqual({
      'nmea.gateway.host': undefined,
      'nmea.gateway.port': undefined,
      'vessel.name': undefined,
      'display.keep_awake': true,
    });
  });

  it('applies a platform-dependent default from the supplied platform', () => {
    const platformRegistry = createRegistry({
      'vhf.monitor_audio': defineSetting({
        scopes: ['device'],
        type: boolType,
        default: (platform) => !platform.native,
        label: 'Monitor audio',
      }),
    });
    expect(createSettingsStore({ registry: platformRegistry, stores: [] }).get('vhf.monitor_audio')).toBe(true);
    expect(
      createSettingsStore({ registry: platformRegistry, stores: [], platform: { native: true } }).get(
        'vhf.monitor_audio'
      )
    ).toBe(false);
  });
});
