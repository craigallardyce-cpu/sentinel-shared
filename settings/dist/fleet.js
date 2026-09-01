/**
 * The fleet's declared settings.
 *
 * **Almost nothing here has a default, and that is the design.** A default is a
 * value nobody chose, and every one this fleet shipped turned out to be wrong
 * for every install but the developer's: a home LAN address as the NMEA gateway
 * (`192.168.86.33`, in OceanSentinel's AppContext.jsx), a specific real boat as
 * the boat name, one operator's endpoint as a hosted relay. Each looked like a
 * helpful head start, and each was invisible — a pre-filled field reads as a
 * configured field, so nobody corrects it and nothing reports it.
 *
 * So the owner supplies the values only the owner knows, and until they do a
 * setting is `unset`: a state the settings screen shows as an empty field with
 * a `placeholder`, and that consuming code has to handle rather than mistake for
 * a decision.
 *
 * Two things keep a default, and both are values the app needs before anybody
 * has opened the settings: an on/off toggle, which has to be one way or the
 * other (the registry enforces that a `bool` declares one), and screen
 * brightness, which the first frame has to render at. Nothing else does, and the
 * fleet test names the exceptions so that list cannot quietly grow.
 *
 * Where the apps disagreed about a value, the comment still says so — the record
 * of the disagreement is worth keeping even now that nothing inherits its answer.
 *
 * **Scope so far.** This declares the settings both apps share, plus the ones the
 * NMEA work touches. OceanSentinel's own groups — the VHF tuning, the log book,
 * the twenty-odd `alarm_*` thresholds — are declared when Ocean adopts the
 * registry, because several of them are not settings at all (`vessel_logs`,
 * `vessel_passages` and `vessel_custom_routes` are cached records living in the
 * same flat namespace) and deciding which is which is that step's work.
 */
import { createRegistry, defineSetting } from './registry.js';
import { boolType, hostType, intType, mmsiType, numberType, oneOf, portType, stringType, urlType } from './valueTypes.js';
export const FLEET_SETTINGS = createRegistry({
    // ---------------------------------------------------------------------------
    // Vessel — facts about the boat, and the clearest case for having no defaults:
    // nobody but the owner knows any of them. Today the boat's name lives in
    // HarborSentinel's SQLite, in the cloud `system_config`, in `public.vessels`,
    // and again in OceanSentinel's `vessel_boat_name`.
    // ---------------------------------------------------------------------------
    'vessel.name': defineSetting({
        scopes: ['vessel'],
        type: stringType({ maxLength: 64 }),
        /*
          Three defaults existed and none survives: 'Sentinel' (OceanSentinel),
          'S/V Sentinel' (the `public.vessels` column default) and 'Saorsaa'
          (HarborSentinel's DEFAULTS.BOAT_NAME — a specific real boat, reaching
          every install).
        */
        label: 'Boat name',
        description: 'Shared with every Mariner Sentinel app on this account.',
        placeholder: 'Your boat',
        legacy: { ocean: ['vessel_boat_name'] },
    }),
    'vessel.mmsi': defineSetting({
        scopes: ['vessel'],
        type: mmsiType,
        label: 'MMSI',
        description: 'Nine digits. Suppresses own ship from AIS proximity alarms.',
        placeholder: '9 digits',
        legacy: { ocean: ['vessel_mmsi'] },
    }),
    'vessel.type': defineSetting({
        scopes: ['vessel'],
        type: stringType({ maxLength: 64 }),
        /*
          Unset means "never said", which `propulsionFor` in @sentinel/vessel reads
          as sail — the behaviour every existing install already has.
        */
        label: 'Vessel type',
        placeholder: 'e.g. Sloop',
        legacy: { ocean: ['vessel_type'] },
    }),
    'vessel.bow_roller_height_ft': defineSetting({
        scopes: ['vessel'],
        type: numberType({ min: 0, max: 60 }),
        label: 'Bow roller height',
        description: 'Height above the waterline, in feet. Used to correct anchor rode scope.',
        placeholder: 'feet',
    }),
    // ---------------------------------------------------------------------------
    // Units and display.
    // ---------------------------------------------------------------------------
    'units.metric': defineSetting({
        /*
          Account rather than vessel: it is a preference of the person reading the
          screen, not a property of the boat. Two crew on one boat may reasonably
          disagree, and today they cannot — HarborSentinel syncs `use_metric`
          through the shared `system_config` row.
        */
        scopes: ['account'],
        type: boolType,
        default: false,
        label: 'Metric units',
        legacy: { ocean: ['vessel_use_metric'] },
    }),
    /*
      Brightness keeps its defaults, and is the one group besides the toggles that
      does.
  
      The argument for stripping a default does not apply here: these are not facts
      about a boat that only the owner knows, they are what the screen has to be set
      to before anyone has opened the settings at all. Unset would mean the first
      frame has no brightness to render at, and each app would answer that with its
      own literal — putting back the scattered defaults this package removes, in the
      one place a wrong value is merely inconvenient rather than dangerous.
  
      Both apps already agree on 100 and 60, so nothing is being chosen here that
      was not already true.
    */
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
        label: 'Dim after',
        placeholder: 'minutes',
        legacy: { harbor: ['harbor_sentinel_auto_dim_minutes'], ocean: ['ocean_sentinel_auto_dim_minutes'] },
    }),
    // ---------------------------------------------------------------------------
    // NMEA. The group that forced the layered design, and the one the pool
    // extraction waits on: `resolveNmeaTarget` in @sentinel/marine currently takes
    // HarborSentinel's SQLite row shape, and should take these instead.
    //
    // There is no remote gateway here. A device off the boat reaches the same
    // local address over the VPN, so a `nmea.remote.*` group would be a second
    // address for one gateway — exactly the shape this package exists to stop.
    // HarborSentinel's `nmea_remote_host` / `nmea_remote_port` columns are never
    // selectable as a source and can go with it.
    // ---------------------------------------------------------------------------
    'nmea.source': defineSetting({
        scopes: ['vessel', 'host', 'device'],
        /*
          Only two values are ever written, in either app. No default: which
          instruments a boat has is not something to assume, and an app that
          silently picked 'NMEA LOCAL' would sit waiting on a gateway that may not
          exist rather than asking.
        */
        type: oneOf(['NMEA LOCAL', 'DEVICE GPS']),
        label: 'Instrument source',
        legacy: { ocean: ['vessel_data_source'] },
    }),
    'nmea.gateway.host': defineSetting({
        /*
          Three layers, and all three are needed. The boat's multiplexer is a fact
          about the boat (`vessel`); a PC running the backend may reach it
          differently (`host`); a phone in the cabin reaches it through that PC
          (`device`). HarborSentinel currently fakes the missing layers by stripping
          the host and port out of its payload on Android so a phone cannot
          overwrite the PC's hardware settings — a workaround this declaration
          retires.
        */
        scopes: ['vessel', 'host', 'device'],
        type: hostType,
        /*
          OceanSentinel had three defaults for this one value: '192.168.86.33' in
          AppContext.jsx, '10.10.10.1' in SettingsModal.jsx and '10.10.10.1' in
          NMEAMonitor.jsx. The first is a home LAN address and it shipped. None is
          inherited — the address of a boat's multiplexer is the owner's to give,
          and a wrong one looks exactly like a gateway that is switched off.
        */
        label: 'NMEA gateway address',
        placeholder: 'e.g. 10.10.10.1',
        legacy: { ocean: ['vessel_nmea_local_host'] },
    }),
    'nmea.gateway.port': defineSetting({
        scopes: ['vessel', 'host', 'device'],
        type: portType,
        label: 'NMEA gateway port',
        placeholder: 'e.g. 11102',
        legacy: { ocean: ['vessel_nmea_local_port'] },
    }),
    'nmea.datahub_url': defineSetting({
        scopes: ['vessel', 'host'],
        type: urlType(),
        label: 'Data hub URL',
        placeholder: 'http://…',
    }),
    // ---------------------------------------------------------------------------
    // How this device reaches its backend. Correctly per-device in both apps
    // already — and unset is meaningful here: no backend address means standalone.
    // ---------------------------------------------------------------------------
    'connection.backend_url': defineSetting({
        scopes: ['device'],
        type: urlType(),
        label: 'Backend address',
        description: 'Leave empty to run standalone on this device.',
        placeholder: 'http://…',
        legacy: { harbor: ['vessel_backend_api_url'], ocean: ['vessel_backend_api_url'] },
    }),
    'connection.tile_proxy_url': defineSetting({
        scopes: ['device'],
        type: urlType(),
        label: 'Chart tile proxy',
        placeholder: 'http://…',
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
          messages in one night at anchor. The bounds stay; the ring size does not,
          because how close is too close depends on the boat and the anchorage.
        */
        type: numberType({ min: 0.008, max: 5 }),
        label: 'AIS proximity limit',
        placeholder: 'nautical miles',
    }),
    'alarms.wind_limit_kt': defineSetting({
        scopes: ['host'],
        type: numberType({ min: 0, max: 100 }),
        label: 'Wind alarm limit',
        placeholder: 'knots',
    }),
    'alarms.depth_limit_ft': defineSetting({
        scopes: ['host'],
        type: numberType({ min: 0, max: 200 }),
        label: 'Depth alarm limit',
        placeholder: 'feet',
    }),
});
