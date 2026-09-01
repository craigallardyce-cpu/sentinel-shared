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
    Constructing it at all is the gate: createRegistry checks that every declared
    default satisfies its own type, on both platform branches. Importing this
    module is therefore the assertion that no default in the fleet is wrong.
  */
  it('constructs, which means every declared default parses', () => {
    expect(FLEET_SETTINGS.keys().length).toBeGreaterThan(0);
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
  it('has one NMEA gateway default, and it is not the home LAN address that shipped', () => {
    const host = FLEET_SETTINGS.get('nmea.gateway.host');
    expect(host.default).toBe('10.10.10.1');
    expect(host.default).not.toBe('192.168.86.33');
    expect(FLEET_SETTINGS.get('nmea.gateway.port').default).toBe(11102);
  });

  it('agrees with DEFAULT_NMEA_TARGET in @sentinel/marine', () => {
    // Kept as a literal rather than an import so this package stays dependency-free;
    // the drift checker is what will hold the two together.
    expect({
      host: FLEET_SETTINGS.get('nmea.gateway.host').default,
      port: String(FLEET_SETTINGS.get('nmea.gateway.port').default),
    }).toEqual({ host: '10.10.10.1', port: '11102' });
  });

  it('lets the gateway be held at the three layers the phone/PC split needs', () => {
    expect(FLEET_SETTINGS.get('nmea.gateway.host').scopes).toEqual(['vessel', 'host', 'device']);
  });

  it('does not default the boat name to a specific real boat', () => {
    expect(FLEET_SETTINGS.get('vessel.name').default).toBe('Sentinel');
    expect(FLEET_SETTINGS.get('vessel.name').default).not.toBe('Saorsaa');
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

  it('gives a fresh OceanSentinel install the declared gateway, not the home LAN one', () => {
    const settings = createSettingsStore({
      registry: FLEET_SETTINGS,
      stores: [createDeviceStore(memoryStorage(), { app: 'ocean', registry: FLEET_SETTINGS })],
      platform: { native: true },
    });
    expect(settings.resolve('nmea.gateway.host')).toEqual({ value: '10.10.10.1', source: 'default' });
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
    expect(settings.get('display.night_brightness')).toBe(60);
  });
});

describe('what this public package deliberately does not ship', () => {
  it('carries no relay endpoint as a default', () => {
    // sentinel-shared is public. A hosted relay address is one operator's
    // deployment configuration and is supplied at the vessel or host layer.
    expect(FLEET_SETTINGS.get('nmea.remote.host').default).toBe('');
  });
});
