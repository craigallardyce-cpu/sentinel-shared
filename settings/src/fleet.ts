/**
 * The fleet's declared settings.
 *
 * Every default here was read out of the working tree rather than chosen, and
 * where the apps disagreed the comment says so and says which one won. That is
 * the point of the file: after this, there is one answer per setting, and the
 * disagreement is visible in the history instead of spread across six files.
 *
 * **Scope so far.** This declares the settings that both apps share, plus the
 * ones the NMEA work touches. OceanSentinel's own groups — the VHF tuning, the
 * log book, the twenty-odd `alarm_*` thresholds — are declared when Ocean adopts
 * the registry, because several of them are not settings at all (`vessel_logs`,
 * `vessel_passages` and `vessel_custom_routes` are cached records living in the
 * same flat namespace) and deciding which is which is that step's work, not
 * something to guess at here.
 */

import { createRegistry, defineSetting } from './registry.js';
import {
  boolType,
  hostType,
  hostTypeWith,
  intType,
  mmsiType,
  numberType,
  oneOf,
  portType,
  stringType,
  urlType,
} from './valueTypes.js';

export const FLEET_SETTINGS = createRegistry({
  // ---------------------------------------------------------------------------
  // Vessel — facts about the boat. Shared by every app on the account, which is
  // exactly what they are not today: the boat's name lives in HarborSentinel's
  // SQLite, in the cloud `system_config`, in `public.vessels`, and again in
  // OceanSentinel's `vessel_boat_name`.
  // ---------------------------------------------------------------------------

  'vessel.name': defineSetting({
    scopes: ['vessel'],
    type: stringType({ maxLength: 64 }),
    /*
      Three defaults existed: 'Sentinel' (OceanSentinel), 'S/V Sentinel' (the
      `public.vessels` column default) and 'Saorsaa' (HarborSentinel's
      DEFAULTS.BOAT_NAME). The last is a specific real boat and is the same class
      of mistake as shipping a home LAN address — a developer's own value reaching
      every install. The neutral one wins.
    */
    default: 'Sentinel',
    label: 'Boat name',
    description: 'Shared with every Mariner Sentinel app on this account.',
    legacy: { ocean: ['vessel_boat_name'] },
  }),

  'vessel.mmsi': defineSetting({
    scopes: ['vessel'],
    type: mmsiType,
    default: '',
    label: 'MMSI',
    description: 'Nine digits. Suppresses own ship from AIS proximity alarms.',
    legacy: { ocean: ['vessel_mmsi'] },
  }),

  'vessel.type': defineSetting({
    scopes: ['vessel'],
    type: stringType({ allowEmpty: true, maxLength: 64 }),
    /*
      Empty means "never said", which `propulsionFor` in @sentinel/vessel reads as
      sail — the behaviour every existing install already has. Declaring a
      concrete default here would silently change that for anyone who never set it.
    */
    default: '',
    label: 'Vessel type',
    legacy: { ocean: ['vessel_type'] },
  }),

  'vessel.bow_roller_height_ft': defineSetting({
    scopes: ['vessel'],
    type: numberType({ min: 0, max: 60 }),
    default: 5.5,
    label: 'Bow roller height',
    description: 'Height above the waterline, in feet. Used to correct anchor rode scope.',
  }),

  // ---------------------------------------------------------------------------
  // Units and display.
  // ---------------------------------------------------------------------------

  'units.metric': defineSetting({
    /*
      Account rather than vessel: it is a preference of the person reading the
      screen, not a property of the boat. Two crew on one boat may reasonably
      disagree, and today they cannot — HarborSentinel syncs `use_metric` through
      the shared `system_config` row.
    */
    scopes: ['account'],
    type: boolType,
    default: false,
    label: 'Metric units',
    legacy: { ocean: ['vessel_use_metric'] },
  }),

  'display.day_brightness': defineSetting({
    scopes: ['device'],
    type: intType({ min: 20, max: 100 }),
    default: 100,
    label: 'Day brightness',
    legacy: { harbor: ['day_brightness'], ocean: ['day_brightness'] },
  }),

  'display.night_brightness': defineSetting({
    scopes: ['device'],
    type: intType({ min: 10, max: 100 }),
    default: 60,
    label: 'Night brightness',
    legacy: { harbor: ['night_brightness'], ocean: ['night_brightness'] },
  }),

  'display.keep_awake': defineSetting({
    scopes: ['device'],
    type: boolType,
    default: false,
    label: 'Keep the screen awake',
    /*
      One setting, two key names, which is why nothing could ever have synced it
      and why nine existing drift checks never noticed.
    */
    legacy: { harbor: ['harbor_sentinel_keep_awake'], ocean: ['ocean_sentinel_keep_awake'] },
  }),

  'display.auto_dim': defineSetting({
    scopes: ['device'],
    type: boolType,
    default: false,
    label: 'Dim when idle',
    description: 'Only applies while the screen is being kept awake.',
    legacy: { harbor: ['harbor_sentinel_auto_dim'], ocean: ['ocean_sentinel_auto_dim'] },
  }),

  'display.auto_dim_minutes': defineSetting({
    scopes: ['device'],
    type: intType({ min: 1, max: 120 }),
    default: 5,
    label: 'Dim after',
    legacy: { harbor: ['harbor_sentinel_auto_dim_minutes'], ocean: ['ocean_sentinel_auto_dim_minutes'] },
  }),

  // ---------------------------------------------------------------------------
  // NMEA. The group that forced the layered design, and the one the pool
  // extraction waits on: `resolveNmeaTarget` in @sentinel/marine currently takes
  // HarborSentinel's SQLite row shape, and should take these instead.
  // ---------------------------------------------------------------------------

  'nmea.source': defineSetting({
    scopes: ['vessel', 'host', 'device'],
    /*
      Only two values are ever written, in either app, despite HarborSentinel
      carrying `nmea_remote_host` and `nmea_remote_port` columns — there is no
      'NMEA REMOTE' source. The remote gateway is reachable but not selectable,
      which is worth knowing before anyone treats those columns as live.
    */
    type: oneOf(['NMEA LOCAL', 'DEVICE GPS'] as const),
    default: 'NMEA LOCAL',
    label: 'Instrument source',
    legacy: { ocean: ['vessel_data_source'] },
  }),

  'nmea.gateway.host': defineSetting({
    /*
      Three layers, and all three are needed. The boat's multiplexer is a fact
      about the boat (`vessel`); a PC running the backend may reach it
      differently (`host`); a phone in the cabin reaches it through that PC
      (`device`). HarborSentinel currently fakes the missing layers by stripping
      the host and port out of its payload on Android so a phone cannot overwrite
      the PC's hardware settings — a workaround this declaration retires.
    */
    scopes: ['vessel', 'host', 'device'],
    type: hostType,
    /*
      OceanSentinel had three defaults for this one value: '192.168.86.33' in
      AppContext.jsx, '10.10.10.1' in SettingsModal.jsx and '10.10.10.1' in
      NMEAMonitor.jsx. The first is a home LAN address and it ships. The gateway
      most boats actually have wins, which is also DEFAULT_NMEA_TARGET in
      @sentinel/marine — the same constant, finally in one place.
    */
    default: '10.10.10.1',
    label: 'NMEA gateway address',
    legacy: { ocean: ['vessel_nmea_local_host'] },
  }),

  'nmea.gateway.port': defineSetting({
    scopes: ['vessel', 'host', 'device'],
    type: portType,
    default: 11102,
    label: 'NMEA gateway port',
    legacy: { ocean: ['vessel_nmea_local_port'] },
  }),

  'nmea.remote.host': defineSetting({
    scopes: ['vessel', 'host'],
    type: hostTypeWith({ allowEmpty: true }),
    /*
      Empty on purpose, and the one place this file deliberately does NOT carry
      the value the apps use today.

      A hosted relay address is deployment configuration for one operator, not a
      fact about how the fleet works — unlike the boat-side gateway, which really
      is the same 10.10.10.1 on most installs. It also has no per-phone answer,
      hence no device scope. Whoever runs a relay supplies its address at the
      vessel or host layer; sentinel-shared is a public repository and has no
      business shipping somebody's endpoint as a default.
    */
    default: '',
    label: 'Remote gateway address',
    description: 'Optional internet-reachable NMEA relay. Empty means none.',
  }),

  'nmea.remote.port': defineSetting({
    scopes: ['vessel', 'host'],
    type: portType,
    default: 11102,
    label: 'Remote gateway port',
  }),

  'nmea.datahub_url': defineSetting({
    scopes: ['vessel', 'host'],
    type: urlType(),
    default: 'http://10.10.10.1:11102',
    label: 'Data hub URL',
  }),

  // ---------------------------------------------------------------------------
  // How this device reaches its backend. Correctly per-device in both apps
  // already — the one thing both got right, and by agreement rather than luck:
  // an empty value is how each app says "standalone, no PC to talk to".
  // ---------------------------------------------------------------------------

  'connection.backend_url': defineSetting({
    scopes: ['device'],
    type: urlType({ allowEmpty: true }),
    default: '',
    label: 'Backend address',
    description: 'Empty runs standalone on this device.',
    legacy: { harbor: ['vessel_backend_api_url'], ocean: ['vessel_backend_api_url'] },
  }),

  'connection.tile_proxy_url': defineSetting({
    scopes: ['device'],
    type: urlType({ allowEmpty: true }),
    default: '',
    label: 'Chart tile proxy',
    legacy: { harbor: ['vessel_tile_proxy_url'] },
  }),

  // ---------------------------------------------------------------------------
  // Alarms. Host scope, not account: HarborSentinel evaluates the AIS proximity
  // alarm on-device against a local target list, which is why the cloud
  // `system_config` table deliberately has no column for any of these.
  // ---------------------------------------------------------------------------

  'alarms.ais_proximity.enabled': defineSetting({
    scopes: ['host'],
    type: boolType,
    default: false,
    label: 'AIS proximity alarm',
  }),

  'alarms.ais_proximity.limit_nm': defineSetting({
    scopes: ['host'],
    /*
      The bounds are AIS_PROXIMITY.MIN_LIMIT_NM and MAX_LIMIT_NM from
      HarborSentinel's shared/constants.ts, where the comment records why they
      exist: the first version of this feature sent roughly a thousand Telegram
      messages in one night at anchor. The default is DEFAULT_LIMIT_FT (50 ft)
      converted with the FT_PER_NM constant from the same file.
    */
    type: numberType({ min: 0.008, max: 5 }),
    default: 50 / 6076.12,
    label: 'AIS proximity limit',
  }),

  'alarms.wind_limit_kt': defineSetting({
    scopes: ['host'],
    type: numberType({ min: 0, max: 100 }),
    default: 25,
    label: 'Wind alarm limit',
  }),

  'alarms.depth_limit_ft': defineSetting({
    scopes: ['host'],
    type: numberType({ min: 0, max: 200 }),
    default: 7,
    label: 'Depth alarm limit',
  }),
});

export type FleetSettings = typeof FLEET_SETTINGS;
