"use strict";
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
 * What keeps a default is what the app needs before anybody has opened the
 * settings: on/off toggles, which have to be one way or the other (the registry
 * enforces that a `bool` declares one), screen brightness, which the first frame
 * has to render at, and the auto-dim interval, without which its toggle would
 * switch on and do nothing. Nothing else does, and the fleet test names the
 * exceptions so that list cannot quietly grow.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLEET_SETTINGS = void 0;
const registry_js_1 = require("./registry.js");
const valueTypes_js_1 = require("./valueTypes.js");
exports.FLEET_SETTINGS = (0, registry_js_1.createRegistry)({
    // ---------------------------------------------------------------------------
    // Vessel — facts about the boat, and the clearest case for having no defaults:
    // nobody but the owner knows any of them. Today the boat's name lives in
    // HarborSentinel's SQLite, in the cloud `system_config`, in `public.vessels`,
    // and again in OceanSentinel's `vessel_boat_name`.
    // ---------------------------------------------------------------------------
    'vessel.name': (0, registry_js_1.defineSetting)({
        scopes: ['vessel'],
        type: (0, valueTypes_js_1.stringType)({ maxLength: 64 }),
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
    'vessel.mmsi': (0, registry_js_1.defineSetting)({
        scopes: ['vessel'],
        type: valueTypes_js_1.mmsiType,
        label: 'MMSI',
        description: 'Nine digits. Suppresses own ship from AIS proximity alarms.',
        placeholder: '9 digits',
        legacy: { ocean: ['vessel_mmsi'] },
    }),
    'vessel.type': (0, registry_js_1.defineSetting)({
        scopes: ['vessel'],
        type: (0, valueTypes_js_1.stringType)({ maxLength: 64 }),
        /*
          Unset means "never said", which `propulsionFor` in @sentinel/vessel reads
          as sail — the behaviour every existing install already has.
        */
        label: 'Vessel type',
        placeholder: 'e.g. Sloop',
        legacy: { ocean: ['vessel_type'] },
    }),
    'vessel.bow_roller_height_ft': (0, registry_js_1.defineSetting)({
        scopes: ['vessel'],
        type: (0, valueTypes_js_1.numberType)({ min: 0, max: 60 }),
        label: 'Bow roller height',
        description: 'Height above the waterline, in feet. Used to correct anchor rode scope.',
        placeholder: 'feet',
    }),
    // ---------------------------------------------------------------------------
    // Units and display.
    // ---------------------------------------------------------------------------
    'units.metric': (0, registry_js_1.defineSetting)({
        /*
          A preference of the person reading the screen, not a property of the boat —
          so it follows the account across their devices, and a device may still
          override it. Both layers are needed and the argument for the second is the
          same one that rules out `vessel`: two crew on one boat may reasonably
          disagree, and today they cannot, because HarborSentinel syncs `use_metric`
          through the one shared `system_config` row.
    
          Declaring `device` is also what lets the pre-registry value be read at all.
          A store is only consulted for a scope the setting declares, so with
          `account` alone the `vessel_use_metric` below was silently unreachable and
          a navigator who had chosen metric would have come back to feet.
        */
        scopes: ['account', 'device'],
        type: valueTypes_js_1.boolType,
        /*
          False is Imperial, which is what both apps do today: HarborSentinel's
          column is `use_metric INTEGER DEFAULT 0` and OceanSentinel reads
          `parseInt(localStorage.getItem('vessel_use_metric') || '0', 10)`.
        */
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
    'display.day_brightness': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.intType)({ min: 20, max: 100 }),
        default: 100,
        label: 'Day brightness',
        legacy: { harbor: ['day_brightness'], ocean: ['day_brightness'] },
    }),
    'display.night_brightness': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.intType)({ min: 10, max: 100 }),
        default: 60,
        label: 'Night brightness',
        legacy: { harbor: ['night_brightness'], ocean: ['night_brightness'] },
    }),
    'display.keep_awake': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: valueTypes_js_1.boolType,
        default: false,
        label: 'Keep the screen awake',
        /*
          One setting, two key names, which is why nothing could ever have synced it
          and why nine existing drift checks never noticed.
        */
        legacy: { harbor: ['harbor_sentinel_keep_awake'], ocean: ['ocean_sentinel_keep_awake'] },
    }),
    'display.auto_dim': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: valueTypes_js_1.boolType,
        default: false,
        label: 'Dim when idle',
        description: 'Only applies while the screen is being kept awake.',
        legacy: { harbor: ['harbor_sentinel_auto_dim'], ocean: ['ocean_sentinel_auto_dim'] },
    }),
    'display.auto_dim_minutes': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.intType)({ min: 1, max: 120 }),
        /*
          Paired with the toggle above, and defaulted for the same reason.
    
          Without one, switching auto-dim on did nothing until an interval was also
          chosen — the toggle said yes and the screen never dimmed. A switch that
          needs a second answer before it takes effect is a worse trade than a
          five-minute default nobody objects to, and the interval is not a fact about
          the boat that only the owner can know.
        */
        default: 5,
        label: 'Dim after',
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
    'nmea.source': (0, registry_js_1.defineSetting)({
        scopes: ['vessel', 'host', 'device'],
        /*
          Only two values are ever written, in either app. No default: which
          instruments a boat has is not something to assume, and an app that
          silently picked 'NMEA LOCAL' would sit waiting on a gateway that may not
          exist rather than asking.
        */
        type: (0, valueTypes_js_1.oneOf)(['NMEA LOCAL', 'DEVICE GPS']),
        label: 'Instrument source',
        legacy: { ocean: ['vessel_data_source'] },
    }),
    'nmea.gateway.host': (0, registry_js_1.defineSetting)({
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
        type: valueTypes_js_1.hostType,
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
    'nmea.gateway.port': (0, registry_js_1.defineSetting)({
        scopes: ['vessel', 'host', 'device'],
        type: valueTypes_js_1.portType,
        label: 'NMEA gateway port',
        placeholder: 'e.g. 11102',
        legacy: { ocean: ['vessel_nmea_local_port'] },
    }),
    'nmea.datahub_url': (0, registry_js_1.defineSetting)({
        scopes: ['vessel', 'host'],
        type: (0, valueTypes_js_1.urlType)(),
        label: 'Data hub URL',
        placeholder: 'http://…',
    }),
    // ---------------------------------------------------------------------------
    // How this device reaches its backend. Correctly per-device in both apps
    // already — and unset is meaningful here: no backend address means standalone.
    // ---------------------------------------------------------------------------
    'connection.backend_url': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.urlType)(),
        label: 'Backend address',
        description: 'Leave empty to run standalone on this device.',
        placeholder: 'http://…',
        legacy: { harbor: ['vessel_backend_api_url'], ocean: ['vessel_backend_api_url'] },
    }),
    'connection.tile_proxy_url': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.urlType)(),
        label: 'Chart tile proxy',
        placeholder: 'http://…',
        legacy: { harbor: ['vessel_tile_proxy_url'] },
    }),
    // ---------------------------------------------------------------------------
    // VHF monitoring. OceanSentinel's, and a good illustration of why one scope
    // could never have covered a group: the tuning belongs to the radio and the
    // machine it is plugged into, while the retention policy deletes recordings
    // from every device on the account and therefore cannot be per-device.
    // ---------------------------------------------------------------------------
    'vhf.retention_days': (0, registry_js_1.defineSetting)({
        /*
          Account, and already treated as such before this package existed: the
          comment in OceanSentinel's AppContext says the pruning it drives "reaches
          every device on this account", which is why it was the one setting anybody
          had put in the cloud. Zero means keep transcripts forever, so it is a real
          value rather than an absence -- but it is still the owner's policy to set.
        */
        scopes: ['account'],
        type: (0, valueTypes_js_1.intType)({ min: 0, max: 3650 }),
        label: 'Keep VHF recordings for',
        description: 'Deletes older recordings everywhere. Blank keeps them forever.',
        placeholder: 'days',
        legacy: { ocean: ['vhf_retention_days'] },
    }),
    'vhf.squelch_threshold_db': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.numberType)({ min: -100, max: 0 }),
        label: 'Squelch threshold',
        placeholder: 'dB',
        legacy: { ocean: ['vhf_squelch_threshold'] },
    }),
    'vhf.hangover_ms': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: (0, valueTypes_js_1.intType)({ min: 0, max: 30000 }),
        label: 'Hangover time',
        description: 'How long the receiver keeps recording after a transmission ends.',
        placeholder: 'milliseconds',
        legacy: { ocean: ['hangover_time'] },
    }),
    'vhf.monitor_audio': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        type: valueTypes_js_1.boolType,
        /*
          The one genuinely platform-dependent default in the fleet, and the reason
          `default` may be a function at all. OceanSentinel's own comment records
          why: a phone or tablet's microphone is usually the input, so playing it
          back through the built-in speaker feeds the mic straight into itself. A PC
          on a radio's line-out wants to hear the traffic.
        */
        default: (platform) => !platform.native,
        label: 'Monitor audio through the speaker',
        legacy: { ocean: ['vhf_monitor_audio'] },
    }),
    // ---------------------------------------------------------------------------
    // Log book.
    // ---------------------------------------------------------------------------
    'logbook.auto_interval_min': (0, registry_js_1.defineSetting)({
        scopes: ['account'],
        type: (0, valueTypes_js_1.intType)({ min: 1, max: 1440 }),
        label: 'Automatic entry interval',
        placeholder: 'minutes',
        legacy: { ocean: ['log_auto_interval'] },
    }),
    'logbook.included_nmea': (0, registry_js_1.defineSetting)({
        scopes: ['account'],
        /*
          A closed set rather than free strings: a typo here does not fail, it
          silently records one fewer field in the log, and a wrong log entry is
          exactly the kind of quiet error this fleet keeps finding.
        */
        type: (0, valueTypes_js_1.listType)((0, valueTypes_js_1.oneOf)(['position', 'cogSog', 'wind', 'depth', 'temp', 'battery'])),
        label: 'Fields recorded automatically',
        placeholder: 'choose fields',
        legacy: { ocean: ['log_included_nmea'] },
    }),
    'logbook.quick_tap_presets': (0, registry_js_1.defineSetting)({
        scopes: ['account'],
        type: (0, valueTypes_js_1.listType)((0, valueTypes_js_1.stringType)({ maxLength: 60 })),
        label: 'Quick-tap entries',
        placeholder: 'add a phrase',
        legacy: { ocean: ['log_quick_tap_presets'] },
    }),
    // ---------------------------------------------------------------------------
    // Everything else OceanSentinel keeps.
    // ---------------------------------------------------------------------------
    'ai.model': (0, registry_js_1.defineSetting)({
        scopes: ['account'],
        type: (0, valueTypes_js_1.stringType)({ maxLength: 64 }),
        label: 'Transcription model',
        placeholder: 'e.g. gemini-2.5-flash',
        legacy: { ocean: ['gemini_model'] },
    }),
    'alarms.sound_enabled': (0, registry_js_1.defineSetting)({
        scopes: ['device'],
        /*
          Device, not account: whether this screen makes a noise is a property of
          where the screen is. The one at the nav station should be able to be silent
          while the one in the cockpit is not.
        */
        type: valueTypes_js_1.boolType,
        default: true,
        label: 'Alarm sound',
        legacy: { ocean: ['vessel_alarm_sound_enabled'] },
    }),
    // ---------------------------------------------------------------------------
    // Alarms. Host scope, not account: HarborSentinel evaluates the AIS proximity
    // alarm on-device against a local target list, which is why the cloud
    // `system_config` table deliberately has no column for any of these.
    // ---------------------------------------------------------------------------
    'alarms.ais_proximity.enabled': (0, registry_js_1.defineSetting)({
        scopes: ['host'],
        type: valueTypes_js_1.boolType,
        default: false,
        label: 'AIS proximity alarm',
    }),
    'alarms.ais_proximity.limit_nm': (0, registry_js_1.defineSetting)({
        scopes: ['host'],
        /*
          The bounds are AIS_PROXIMITY.MIN_LIMIT_NM and MAX_LIMIT_NM from
          HarborSentinel's shared/constants.ts, where the comment records why they
          exist: the first version of this feature sent roughly a thousand Telegram
          messages in one night at anchor. The bounds stay; the ring size does not,
          because how close is too close depends on the boat and the anchorage.
        */
        type: (0, valueTypes_js_1.numberType)({ min: 0.008, max: 5 }),
        label: 'AIS proximity limit',
        placeholder: 'nautical miles',
    }),
    'alarms.wind_limit_kt': (0, registry_js_1.defineSetting)({
        scopes: ['host'],
        type: (0, valueTypes_js_1.numberType)({ min: 0, max: 100 }),
        label: 'Wind alarm limit',
        placeholder: 'knots',
    }),
    'alarms.depth_limit_ft': (0, registry_js_1.defineSetting)({
        scopes: ['host'],
        type: (0, valueTypes_js_1.numberType)({ min: 0, max: 200 }),
        label: 'Depth alarm limit',
        placeholder: 'feet',
    }),
});
