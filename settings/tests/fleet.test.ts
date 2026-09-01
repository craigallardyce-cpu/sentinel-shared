import { describe, expect, it } from 'vitest';
import { FLEET_SETTINGS } from '../src/fleet.js';
import { createDeviceStore } from '../src/deviceStore.js';
import { createSettingsStore } from '../src/store.js';
import { SCOPE_ORDER } from '../src/types.js';
import type { StorageLike } from '../src/deviceStore.js';

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('the fleet registry', () => {
  /*
    Constructing it at all is the gate: createRegistry checks that every toggle
    declares a default, and that any default declared satisfies its own type on
    both platform branches.
  */
  it('constructs, which means every declared default parses', () => {
    expect(FLEET_SETTINGS.keys().length).toBeGreaterThan(0);
  });

  /*
    The rule the file rests on, with its exceptions named rather than implied.

    Everything a boat's owner is the authority on stays unset until they say so.
    What is left carries a default only because the app needs a value before
    anyone has opened the settings at all: a switch has to be on or off, the
    first frame has to render at some brightness, and auto-dim needs an interval
    or its toggle does nothing. Listing them here is what stops that list growing
    back one well-meant default at a time.
  */
  it('ships a default only for toggles, brightness and the dim interval', () => {
    // Every addition here is forced rather than chosen: createRegistry requires a
    // default on any bool, so a new toggle lands in this list by rule.
    const withDefaults = FLEET_SETTINGS.all()
      .filter((definition) => definition.default !== undefined)
      .map((definition) => definition.key)
      .sort();

    expect(withDefaults).toEqual([
      'alarms.ais_proximity.enabled',
      'alarms.sound_enabled',
      'display.auto_dim',
      'display.auto_dim_minutes',
      'display.day_brightness',
      'display.keep_awake',
      'display.night_brightness',
      'units.metric',
      'vhf.monitor_audio',
    ]);
  });

  it('gives every setting without a default something to show in an empty field', () => {
    for (const definition of FLEET_SETTINGS.all()) {
      if (definition.default !== undefined) continue;
      // An enum offers its own choices, so it needs no placeholder.
      if (definition.type.name.startsWith('oneOf')) continue;
      expect(definition.placeholder, definition.key).toBeTruthy();
    }
  });

  it('gives every setting a label and at least one scope', () => {
    for (const definition of FLEET_SETTINGS.all()) {
      expect(definition.label, definition.key).toBeTruthy();
      expect(definition.scopes.length, definition.key).toBeGreaterThan(0);
      for (const scope of definition.scopes) expect(SCOPE_ORDER).toContain(scope);
    }
  });

  it('declares no legacy key under a name another setting also claims', () => {
    // Two settings reading one old key would make adoption order matter.
    const seen = new Map<string, string>();
    for (const definition of FLEET_SETTINGS.all()) {
      for (const [app, keys] of Object.entries(definition.legacy ?? {})) {
        for (const key of keys) {
          const id = `${app}:${key}`;
          expect(seen.get(id), `${id} claimed by both ${seen.get(id)} and ${definition.key}`).toBeUndefined();
          seen.set(id, definition.key);
        }
      }
    }
  });
});

describe('the settings that had drifted', () => {
  it('inherits none of the three gateway addresses the apps disagreed on', () => {
    // '192.168.86.33' in AppContext.jsx, '10.10.10.1' in SettingsModal.jsx and
    // NMEAMonitor.jsx. The address of a boat's own multiplexer is the owner's
    // to give, and a wrong one looks exactly like a gateway that is switched off.
    expect(FLEET_SETTINGS.get('nmea.gateway.host').default).toBeUndefined();
    expect(FLEET_SETTINGS.get('nmea.gateway.port').default).toBeUndefined();
    expect(FLEET_SETTINGS.get('nmea.gateway.host').placeholder).toBeTruthy();
  });

  it('has no remote gateway at all', () => {
    // A device off the boat reaches the same local address over the VPN, so a
    // second address for one gateway would be the shape this package prevents.
    expect(FLEET_SETTINGS.has('nmea.remote.host')).toBe(false);
    expect(FLEET_SETTINGS.has('nmea.remote.port')).toBe(false);
    expect(FLEET_SETTINGS.keys().filter((key) => key.includes('remote'))).toEqual([]);
  });

  it('lets the gateway be held at the three layers the phone/PC split needs', () => {
    expect(FLEET_SETTINGS.get('nmea.gateway.host').scopes).toEqual(['vessel', 'host', 'device']);
  });

  it('leaves the boat name and MMSI for the owner to give', () => {
    // Three defaults existed: 'Sentinel', 'S/V Sentinel' and 'Saorsaa' — the
    // last a specific real boat, reaching every install.
    expect(FLEET_SETTINGS.get('vessel.name').default).toBeUndefined();
    expect(FLEET_SETTINGS.get('vessel.mmsi').default).toBeUndefined();
  });

  it('keeps the one setting the two apps named differently readable in both', () => {
    const legacy = FLEET_SETTINGS.get('display.keep_awake').legacy;
    expect(legacy?.harbor).toEqual(['harbor_sentinel_keep_awake']);
    expect(legacy?.ocean).toEqual(['ocean_sentinel_keep_awake']);
  });

  it('holds the boat identity fields only at the vessel layer', () => {
    for (const key of ['vessel.name', 'vessel.mmsi', 'vessel.type']) {
      expect(FLEET_SETTINGS.get(key).scopes, key).toEqual(['vessel']);
    }
  });

  it('keeps the AIS proximity tuning off the account, as the cloud schema already assumes', () => {
    // public.system_config deliberately has no column for these: the alarm is
    // evaluated on-device against a local target list.
    for (const key of ['alarms.ais_proximity.enabled', 'alarms.ais_proximity.limit_nm']) {
      expect(FLEET_SETTINGS.get(key).scopes, key).toEqual(['host']);
    }
  });
});

describe('a real device adopting the registry', () => {
  it('keeps every value HarborSentinel had already stored', () => {
    const storage = memoryStorage({
      night_brightness: '45',
      day_brightness: '80',
      harbor_sentinel_keep_awake: 'true',
      harbor_sentinel_auto_dim: 'true',
      harbor_sentinel_auto_dim_minutes: '10',
      vessel_backend_api_url: 'http://192.168.1.50:3000',
    });
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [createDeviceStore(storage, { app: 'harbor', registry: FLEET_SETTINGS })],
    });

    expect(settings.get('display.night_brightness')).toBe(45);
    expect(settings.get('display.day_brightness')).toBe(80);
    expect(settings.get('display.keep_awake')).toBe(true);
    expect(settings.get('display.auto_dim')).toBe(true);
    expect(settings.get('display.auto_dim_minutes')).toBe(10);
    expect(settings.get('connection.backend_url')).toBe('http://192.168.1.50:3000');
  });

  it('leaves a fresh install unset rather than pointing it at a guess', () => {
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [createDeviceStore(memoryStorage(), { app: 'ocean', registry: FLEET_SETTINGS })],
      platform: { native: true },
    });

    expect(settings.resolve('nmea.gateway.host')).toEqual({ value: undefined, source: 'unset' });
    expect(settings.isConfigured('nmea.gateway.host')).toBe(false);
    expect(settings.isConfigured('vessel.name')).toBe(false);

    // The two kinds that still answer: a switch has to be one way or the other,
    // and the first frame has to render at some brightness.
    expect(settings.resolve('display.keep_awake')).toEqual({ value: false, source: 'default' });
    expect(settings.resolve('display.day_brightness')).toEqual({ value: 100, source: 'default' });
    expect(settings.resolve('display.night_brightness')).toEqual({ value: 60, source: 'default' });
  });

  it('ignores a corrupt stored brightness instead of handing on a NaN', () => {
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [
        createDeviceStore(memoryStorage({ 'sentinel.display.night_brightness': 'undefined' }), {
          app: 'ocean',
          registry: FLEET_SETTINGS,
        }),
      ],
    });
    // Brightness is one of the two things that still falls back to a default.
    expect(settings.resolve('display.night_brightness')).toEqual({ value: 60, source: 'default' });
  });

  it('reports a corrupt value on a setting with no default as unset, not as a guess', () => {
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [
        createDeviceStore(memoryStorage({ 'sentinel.nmea.gateway.port': 'not a port' }), {
          app: 'ocean',
          registry: FLEET_SETTINGS,
        }),
      ],
    });
    expect(settings.get('nmea.gateway.port')).toBeUndefined();
    expect(settings.source('nmea.gateway.port')).toBe('unset');
  });
});

describe('legacy values that a device store cannot reach on its own', () => {
  /*
    The trap this names.

    The device store falls back to a setting's old localStorage key — but a store
    is only consulted for a scope the setting declares, so a setting that lives at
    `vessel` or `account` cannot read its own pre-registry value even though that
    value is sitting in localStorage. It resolves to its default instead, silently,
    and the navigator's answer is gone.

    That is fine for a boat name or an MMSI, which genuinely are not per-device and
    must be lifted into the vessel layer by an explicit one-time migration. It was
    NOT fine for units, which is a per-reader preference that simply had the wrong
    scope. Listing the remainder here is what keeps the difference deliberate: a
    fifth entry has to be argued for rather than appearing by omission.
  */
  it('names exactly the settings whose legacy value needs migrateLegacyKeys', () => {
    const unreachable = FLEET_SETTINGS.all()
      .filter((definition) => Object.keys(definition.legacy ?? {}).length > 0)
      .filter((definition) => !definition.scopes.includes('device'))
      .map((definition) => definition.key)
      .sort();

    expect(unreachable).toEqual([
      'ai.model',
      'logbook.auto_interval_min',
      'logbook.included_nmea',
      'logbook.quick_tap_presets',
      'vessel.mmsi',
      'vessel.name',
      'vessel.type',
      'vhf.retention_days',
    ]);
  });

  it('keeps a navigator who chose metric on metric', () => {
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [createDeviceStore(memoryStorage({ vessel_use_metric: '1' }), { app: 'ocean', registry: FLEET_SETTINGS })],
    });
    expect(settings.resolve('units.metric')).toEqual({ value: true, source: 'device' });
  });

  it('defaults to Imperial, as both apps do today', () => {
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [createDeviceStore(memoryStorage(), { app: 'harbor', registry: FLEET_SETTINGS })],
    });
    expect(settings.resolve('units.metric')).toEqual({ value: false, source: 'default' });

    const chose = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [createDeviceStore(memoryStorage({ vessel_use_metric: '0' }), { app: 'ocean', registry: FLEET_SETTINGS })],
    });
    expect(chose.resolve('units.metric')).toEqual({ value: false, source: 'device' });
  });
});
