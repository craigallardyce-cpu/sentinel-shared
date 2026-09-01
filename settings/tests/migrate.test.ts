import { describe, expect, it } from 'vitest';
import { createAccountStore, createVesselStore } from '../src/cloudStore.js';
import { createDeviceStore } from '../src/deviceStore.js';
import { FLEET_SETTINGS } from '../src/fleet.js';
import { DEFAULT_MARKER_KEY, migrateLegacyKeys } from '../src/migrate.js';
import { createRegistry, defineSetting } from '../src/registry.js';
import { createSettingsStore } from '../src/store.js';
import { boolType, stringType } from '../src/valueTypes.js';
import type { SupabaseLike } from '../src/cloudStore.js';
import type { StorageLike } from '../src/deviceStore.js';

function storage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Records what was merged, so a test can assert which layer received a value. */
function client(rows: Record<string, Record<string, unknown> | null> = {}) {
  const merged: Array<{ fn: string; args: unknown }> = [];
  const updated: Array<{ table: string; payload: unknown }> = [];
  const api: SupabaseLike = {
    from: (table: string) => ({
      select: () => ({ match: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) }) }),
      update: (payload: unknown) => ({
        match: async () => {
          updated.push({ table, payload });
          return { error: null };
        },
      }),
    }),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      merged.push({ fn, args });
      return { data: null, error: null };
    },
  };
  return { api, merged, updated };
}

/** OceanSentinel as it is today: everything flat, in localStorage. */
const OCEAN_BEFORE = {
  vessel_boat_name: 'Saorsa',
  vessel_mmsi: '366895720',
  vessel_type: 'Sloop',
  vhf_retention_days: '30',
  gemini_model: 'gemini-2.5-flash',
  log_auto_interval: '15',
  log_included_nmea: '["position","wind","depth"]',
  /*
    The real stored shape, not a convenient one. These have always been
    `{ id, label, text }` records; a fixture of plain strings here is what let the
    setting be declared as a list of strings and still pass.
  */
  log_quick_tap_presets:
    '[{"id":"preset_1","label":"+ Watch Handover","text":"Watch handover completed."},' +
    '{"id":"custom_1","label":"+ Reefed main","text":"Reefed the main to the first reef."}]',
  // Device-scoped: read in place, never migrated.
  night_brightness: '45',
  ocean_sentinel_keep_awake: 'true',
  vessel_use_metric: '1',
};

function build(seed: Record<string, string>, rows: Record<string, Record<string, unknown> | null> = {}) {
  const store = storage(seed);
  const { api, merged, updated } = client(rows);
  const account = createAccountStore(api, 'user-1');
  const vessel = createVesselStore(api);
  const device = createDeviceStore(store, { app: 'ocean', registry: FLEET_SETTINGS });
  const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [account, vessel, device] });
  return { store, api, merged, updated, account, vessel, settings };
}

describe('migrating OceanSentinel', () => {
  it('carries every account and vessel value up, and leaves device values alone', async () => {
    const { store, settings, account, vessel, merged, updated } = build(OCEAN_BEFORE);
    await Promise.all([account.load(), vessel.load()]);

    const result = await migrateLegacyKeys({
      registry: FLEET_SETTINGS,
      settings,
      app: 'ocean',
      storage: store,
      writableScopes: ['account', 'vessel', 'device'],
    });

    expect(result.migrated).toEqual({
      'vessel.name': 'vessel',
      'vessel.mmsi': 'vessel',
      'vessel.type': 'vessel',
      'vhf.retention_days': 'account',
      'logbook.auto_interval_min': 'account',
      'logbook.included_nmea': 'account',
      'logbook.quick_tap_presets': 'account',
      'ai.model': 'account',
    });

    // Identity went to its own columns on public.vessels; the rest merged into a blob.
    expect(updated.map((u) => u.table)).toEqual(['vessels', 'vessels', 'vessels']);
    // Five account settings, five merges -- one key each, never a whole blob.
    expect(merged.map((m) => m.fn)).toEqual(Array(5).fill('merge_user_settings'));
    expect(merged.every((m) => Object.keys((m.args as { patch: object }).patch).length === 1)).toBe(true);

    // Device-scoped settings are read in place, so nothing was written for them.
    expect(result.migrated['display.night_brightness']).toBeUndefined();
    expect(result.migrated['units.metric']).toBeUndefined();
    expect(settings.get('display.night_brightness')).toBe(45);
    expect(settings.get('units.metric')).toBe(true);
  });

  it('does not run twice', async () => {
    const { store, settings, account, vessel } = build(OCEAN_BEFORE);
    await Promise.all([account.load(), vessel.load()]);
    const options = {
      registry: FLEET_SETTINGS,
      settings,
      app: 'ocean' as const,
      storage: store,
      writableScopes: ['account', 'vessel', 'device'] as const,
    };

    await migrateLegacyKeys(options);
    expect(store.getItem(DEFAULT_MARKER_KEY)).toBeTruthy();

    const second = await migrateLegacyKeys(options);
    expect(second.alreadyDone).toBe(true);
    expect(second.migrated).toEqual({});
  });

  it('never overwrites a value the account already holds', async () => {
    // The cloud is the authority. A device that has been offline for a month
    // must not push its stale copy over what somebody set elsewhere.
    const { store, settings, account, vessel, merged } = build(OCEAN_BEFORE, {
      user_settings: { settings: { 'vhf.retention_days': '7', 'ai.model': 'gemini-2.5-pro' } },
    });
    await Promise.all([account.load(), vessel.load()]);

    const result = await migrateLegacyKeys({
      registry: FLEET_SETTINGS,
      settings,
      app: 'ocean',
      storage: store,
      writableScopes: ['account', 'vessel', 'device'],
    });

    expect(result.migrated['vhf.retention_days']).toBeUndefined();
    expect(result.migrated['ai.model']).toBeUndefined();
    expect(settings.get('vhf.retention_days')).toBe(7);
    expect(merged.some((m) => JSON.stringify(m.args).includes('retention'))).toBe(false);
  });

  it('does not migrate into a scope that has no store', async () => {
    const store = storage(OCEAN_BEFORE);
    const device = createDeviceStore(store, { app: 'ocean', registry: FLEET_SETTINGS });
    const settings = createSettingsStore({ registry: FLEET_SETTINGS, stores: [device] });

    const result = await migrateLegacyKeys({
      registry: FLEET_SETTINGS,
      settings,
      app: 'ocean',
      storage: store,
      writableScopes: ['device'],
    });

    // Signed out: nowhere to put an account or vessel value, so nothing moves and
    // the old keys stay where they are for a later attempt.
    expect(result.migrated).toEqual({});
    expect(store.getItem('vessel_boat_name')).toBe('Saorsa');
  });

  it('reports a value it cannot parse instead of writing nonsense', async () => {
    const { store, settings, account, vessel } = build({ vessel_mmsi: '12345', gemini_model: 'ok' });
    await Promise.all([account.load(), vessel.load()]);

    const result = await migrateLegacyKeys({
      registry: FLEET_SETTINGS,
      settings,
      app: 'ocean',
      storage: store,
      writableScopes: ['account', 'vessel', 'device'],
    });

    // Five digits is not an MMSI, and a half-typed one silently stops own-ship
    // suppression -- so it is reported and left behind, not carried forward.
    expect(result.unparseable).toContain('vessel.mmsi');
    expect(result.migrated['vessel.mmsi']).toBeUndefined();
    expect(result.migrated['ai.model']).toBe('account');
  });

  it('leaves a legacy value that merely equals the default as unset', async () => {
    /*
      Otherwise "nobody has said" silently becomes "somebody chose this", and the
      settings screen shows an answer where it should show an empty field.

      Tested against a registry of its own rather than the fleet's, because no
      fleet setting currently reaches this branch: defaults exist only on the
      toggles, brightness and the dim interval, and every one of those is
      device-scoped and therefore read in place rather than migrated. The branch
      is here for the first account-scoped toggle somebody declares.
    */
    const registry = createRegistry({
      'alerts.email': defineSetting({
        scopes: ['account'],
        type: boolType,
        default: false,
        label: 'Email alerts',
        legacy: { ocean: ['ocean_email_alerts'] },
      }),
      'alerts.address': defineSetting({
        scopes: ['account'],
        type: stringType(),
        label: 'Alert address',
        placeholder: 'name@example.com',
        legacy: { ocean: ['ocean_alert_address'] },
      }),
    });

    const store = storage({ ocean_email_alerts: 'false', ocean_alert_address: 'crew@example.com' });
    const { api } = client();
    const account = createAccountStore(api, 'user-1');
    const settings = createSettingsStore({ registry, stores: [account] });
    await account.load();

    const result = await migrateLegacyKeys({
      registry,
      settings,
      app: 'ocean',
      storage: store,
      writableScopes: ['account'],
    });

    expect(result.migrated['alerts.email']).toBeUndefined();
    expect(result.migrated['alerts.address']).toBe('account');
  });

  it('reports what it would do without writing, for a dry run', async () => {
    const { store, settings, account, vessel, merged } = build(OCEAN_BEFORE);
    await Promise.all([account.load(), vessel.load()]);

    const result = await migrateLegacyKeys({
      registry: FLEET_SETTINGS,
      settings,
      app: 'ocean',
      storage: store,
      writableScopes: ['account', 'vessel', 'device'],
      dryRun: true,
    });

    expect(Object.keys(result.migrated).length).toBe(8);
    expect(merged).toEqual([]);
    expect(store.getItem(DEFAULT_MARKER_KEY)).toBeNull();
  });
});
