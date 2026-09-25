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
 * **Scope.** This declares the settings the apps share, the ones the NMEA work
 * touches, and OceanSentinel's own groups: the VHF tuning, the log book, the
 * alarm thresholds, and (since the settings burndown of 2026-09-25) the entered
 * position, the underway advisory's limits and watch, and the last three chart
 * and console preferences. What Ocean still keeps in flat keys is not a setting
 * and says so where it is stored with a `settings-data-exempt` marker: the ship's
 * log, the owner's routes and marks, sync bookkeeping, and the router's
 * description of the hull (boat facts and polar), which its own CLAUDE.md keeps
 * on the device on purpose.
 */
import { createRegistry, defineSetting } from './registry.js';
import { boolType, hostType, intType, listType, mmsiType, numberType, oneOf, portType, shapeType, stringType, urlType, } from './valueTypes.js';
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
        description: 'Shared with every MarinerSentinel app on this account.',
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
        type: boolType,
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
    'display.day_brightness': defineSetting({
        scopes: ['device'],
        type: intType({ min: 20, max: 100 }),
        default: 100,
        label: 'Day brightness',
        legacy: {
            harbor: ['day_brightness'],
            ocean: ['day_brightness'],
            'vessel-keeper': ['vesselkeeper_day_brightness'],
        },
    }),
    'display.night_brightness': defineSetting({
        scopes: ['device'],
        type: intType({ min: 10, max: 100 }),
        default: 60,
        label: 'Night brightness',
        legacy: {
            harbor: ['night_brightness'],
            ocean: ['night_brightness'],
            'vessel-keeper': ['vesselkeeper_night_brightness'],
        },
    }),
    'display.night_mode': defineSetting({
        scopes: ['device'],
        type: boolType,
        /*
          A toggle, so it must declare one. False is day.
    
          Declaring this turned up a real difference between the apps rather than
          merely a naming one: VesselKeeper persists night mode, and HarborSentinel
          and OceanSentinel do not -- both hold it in `useState(false)`, so it resets
          to day on every restart. On a boat at night that means relaunching the app
          throws a bright screen at whoever is on watch, which is the one thing the
          red-shifted palette exists to prevent. Neither app reads this yet; the
          setting is declared where it belongs so that fixing them is a two-line
          change rather than a third key name.
        */
        default: false,
        label: 'Night mode',
        description: 'Red-shifted palette that preserves night vision.',
        legacy: { 'vessel-keeper': ['vesselkeeper_night_mode'] },
    }),
    'display.density': defineSetting({
        scopes: ['device'],
        /*
          No default, on the same grounds as `nmea.source`: a table can render at
          either density, so there is no frame that cannot be drawn without one --
          only a preference to leave unset until a person expresses it. What each
          app shows before that is its own call (VesselKeeper defaults the *effective*
          value to comfortable on a touch device and compact on a mouse-driven one,
          entirely client-side); the registry does not bake that judgement in.
        */
        type: oneOf(['compact', 'comfortable']),
        label: 'Row density',
        description: 'How tightly packed rows are in tables with many of them.',
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
        legacy: {
            harbor: ['vessel_backend_api_url'],
            ocean: ['vessel_backend_api_url'],
            'vessel-keeper': ['vesselkeeper_server_url'],
        },
    }),
    /*
      The boat PC's pairing token, published by the machine that mints it.
  
      Vessel-scoped, and that is the whole mechanism: the desktop reads its own
      token over loopback and writes it here, and every device on the account
      already syncs this layer with an offline cache. So a phone arrives holding
      the token without anyone reading sixteen hex characters aloud across a
      cabin, which is what OceanSentinel's settings dialog asked for.
  
      It stays beside the address rather than replacing it. The address is still
      typed -- it is per-device, and a typed address is the one thing that works
      identically on the boat's own network and through a tunnel from ashore. Only
      the credential travels this way.
  
      Not a device setting: the token belongs to the boat's backend, not to the
      phone reading it, and a device layer would have to be filled in per device,
      which is the problem. Not an account setting either -- an owner with two
      boats has two backends and two tokens.
  
      Whoever can read this row can already reach the boat's backend on equal
      terms, since it is the same account that owns the machine; `vessel_settings`
      is owner-only. What changes is that the token is now as strong as the
      account rather than as the cabin it was read out in -- and rotating it
      finally propagates, instead of stranding every paired device.
    */
    'connection.pairing_token': defineSetting({
        scopes: ['vessel'],
        type: stringType({ maxLength: 128 }),
        label: 'Pairing token',
        description: 'Published by the boat PC. Devices on this account pick it up automatically.',
        managed: true,
    }),
    'connection.tile_proxy_url': defineSetting({
        scopes: ['device'],
        type: urlType(),
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
    'vhf.retention_days': defineSetting({
        /*
          Account, and already treated as such before this package existed: the
          comment in OceanSentinel's AppContext says the pruning it drives "reaches
          every device on this account", which is why it was the one setting anybody
          had put in the cloud. Zero means keep transcripts forever, so it is a real
          value rather than an absence -- but it is still the owner's policy to set.
        */
        scopes: ['account'],
        type: intType({ min: 0, max: 3650 }),
        label: 'Keep VHF recordings for',
        description: 'Deletes older recordings everywhere. Blank keeps them forever.',
        placeholder: 'days',
        legacy: { ocean: ['vhf_retention_days'] },
    }),
    'vhf.squelch_threshold_db': defineSetting({
        scopes: ['device'],
        type: numberType({ min: -100, max: 0 }),
        label: 'Squelch threshold',
        placeholder: 'dB',
        legacy: { ocean: ['vhf_squelch_threshold'] },
    }),
    'vhf.hangover_ms': defineSetting({
        scopes: ['device'],
        type: intType({ min: 0, max: 30000 }),
        label: 'Hangover time',
        description: 'How long the receiver keeps recording after a transmission ends.',
        placeholder: 'milliseconds',
        legacy: { ocean: ['hangover_time'] },
    }),
    'vhf.monitor_audio': defineSetting({
        scopes: ['device'],
        type: boolType,
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
    'logbook.auto_interval_min': defineSetting({
        scopes: ['account'],
        type: intType({ min: 1, max: 1440 }),
        label: 'Automatic entry interval',
        placeholder: 'minutes',
        legacy: { ocean: ['log_auto_interval'] },
    }),
    'logbook.included_nmea': defineSetting({
        scopes: ['account'],
        /*
          A closed set rather than free strings: a typo here does not fail, it
          silently records one fewer field in the log, and a wrong log entry is
          exactly the kind of quiet error this fleet keeps finding.
        */
        type: listType(oneOf(['position', 'cogSog', 'wind', 'depth', 'temp', 'battery'])),
        label: 'Fields recorded automatically',
        placeholder: 'choose fields',
        legacy: { ocean: ['log_included_nmea'] },
    }),
    'logbook.quick_tap_presets': defineSetting({
        scopes: ['account'],
        /*
          Records, not strings. Declared as a list of strings first, which would have
          rejected every stored value OceanSentinel has -- the presets have always
          been `{ id, label, text }` -- and left the setting reading as unset while
          four call sites quietly fell back to their own copy of the list.
        */
        type: listType(shapeType('preset', {
            id: stringType({ maxLength: 40 }),
            label: stringType({ maxLength: 60 }),
            text: stringType({ maxLength: 500 }),
        })),
        /*
          A starter list, and one of the few defaults that survives.
    
          It is not a fact about a boat that only its owner knows; it is a set of
          phrases anybody keeping a log would want on the first watch, and an empty
          quick-tap row on a fresh install is worse than a list somebody edits. The
          same argument brightness and the auto-dim interval won.
    
          This is now the only copy. OceanSentinel had it in QuickPresetsModal.jsx
          with three call sites falling back to it by hand.
        */
        default: [
            { id: 'preset_1', label: '+ Watch Handover', text: 'Watch handover completed. All systems normal.' },
            { id: 'preset_2', label: '+ Engine Room Walk', text: 'Engine room walk completed. Fluids & belts normal.' },
            { id: 'preset_3', label: '+ Bilge Check Dry', text: 'Bilge checked dry. Pumps off.' },
            { id: 'preset_4', label: '+ Deck Walk', text: 'Deck & rig walk completed. Lines secure.' },
            { id: 'preset_5', label: '+ Rig Inspection', text: 'Rigging and standing gear inspected. All secure.' },
            { id: 'preset_6', label: '+ Weather Check', text: 'Weather observation recorded. Conditions steady.' },
            { id: 'preset_7', label: '+ Sail Trim', text: 'Adjusted sail trim for wind shift.' },
            { id: 'preset_8', label: '+ Traffic Clear', text: 'Monitored passing AIS traffic. Safe CPA maintained.' },
        ],
        label: 'Quick-tap entries',
        legacy: { ocean: ['log_quick_tap_presets'] },
    }),
    'logbook.instruments_range_hours': defineSetting({
        /*
          How many hours back the ship's-log instruments console charts. A property
          of the screen it is read on, like the chart group's vector length, so
          device-scoped.
    
          It keeps a default for the same reason `chart.vector_minutes` does: the
          console cannot be drawn with no time window at all, and 12 is what
          OceanSentinel's InstrumentsPanel has always opened on. The bounds are that
          panel's own choices, 1h to 48h.
        */
        scopes: ['device'],
        type: intType({ min: 1, max: 48 }),
        default: 12,
        label: 'Instruments window',
        placeholder: 'hours',
        legacy: { ocean: ['vessel_console_range_hours'] },
    }),
    // ---------------------------------------------------------------------------
    // Everything else OceanSentinel keeps.
    // ---------------------------------------------------------------------------
    'ai.model': defineSetting({
        scopes: ['account'],
        type: stringType({ maxLength: 64 }),
        label: 'Transcription model',
        placeholder: 'e.g. gemini-2.5-flash',
        legacy: { ocean: ['gemini_model'] },
    }),
    'alarms.sound_enabled': defineSetting({
        scopes: ['device'],
        /*
          Device, not account: whether this screen makes a noise is a property of
          where the screen is. The one at the nav station should be able to be silent
          while the one in the cockpit is not.
        */
        type: boolType,
        default: true,
        label: 'Alarm sound',
        legacy: { ocean: ['vessel_alarm_sound_enabled'] },
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
    /*
      OceanSentinel's telemetry threshold alarms.
  
      Twelve values the chartplotter kept in raw localStorage under `alarm_*`. Two
      of them were already declared here at `host` scope and read by nothing, so
      they are reused rather than duplicated -- a wind limit and a depth limit are
      a wind limit and a depth limit, whichever screen sets them.
  
      Scoped `vessel` then `device`. A depth alarm is a fact about the boat, so a
      phone in the cockpit should inherit what the nav station set; a device
      override is there for whoever wants a tighter one on their own screen. The UI
      writes at `device`, because a navigator setting an alarm offshore has no
      connection to write a vessel layer with, and an alarm that silently failed to
      save would be worse than one that only covers this screen.
  
      Every threshold below is stored in a CANONICAL unit -- feet, knots, degrees
      -- never in whatever the display happens to be showing. `alarm_depth_min` was
      stored in the displayed unit, so a navigator who set a ten foot alarm and
      later switched the app to metric was left with a ten METRE one: an alarm that
      fires at thirty-three feet, or never, depending which way it went. Nothing
      announced the change. Conversion now happens at the input, once.
    */
    'alarms.wind_limit_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 100 }),
        label: 'Wind alarm limit',
        description: 'Alarm above this true wind speed.',
        placeholder: 'knots',
        legacy: { ocean: ['alarm_tws_max'] },
    }),
    'alarms.depth_limit_ft': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 200 }),
        label: 'Depth alarm limit',
        description: 'Alarm below this depth. Always feet, whatever the display shows.',
        placeholder: 'feet',
        /*
          Deliberately NOT migrated by key name. The stored number's unit depended on
          what `units.metric` happened to be when it was typed, so carrying it across
          verbatim would relabel a reading in metres as one in feet. OceanSentinel
          converts it explicitly on upgrade instead.
        */
    }),
    'alarms.sog_max_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 100 }),
        label: 'Speed over ground limit',
        placeholder: 'knots',
        legacy: { ocean: ['alarm_sog_max'] },
    }),
    'alarms.boat_speed_max_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 100 }),
        label: 'Boat speed limit',
        placeholder: 'knots',
        legacy: { ocean: ['alarm_boat_spd_max'] },
    }),
    /*
      The low limits wake a crew when the wind dies, to trim or start the engine.
      No legacy keys: OceanSentinel never had a low limit to carry across.
    */
    'alarms.sog_min_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 100 }),
        label: 'Low speed over ground limit',
        description: 'Alarm below this speed over ground.',
        placeholder: 'knots',
    }),
    'alarms.boat_speed_min_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 100 }),
        label: 'Low boat speed limit',
        description: 'Alarm below this speed through the water.',
        placeholder: 'knots',
    }),
    /*
      OceanSentinel's AIS collision alarm: a target sounds the alarm when its
      closest point of approach is inside the CPA limit AND that approach is due
      within the TCPA limit -- both at once, never either alone, so a ship that
      will pass close in two hours, or one that is near now but opening, stays
      visual. Like the telemetry limits above there is no separate on/off: the
      alarm is armed when both limits are set, and off when either is cleared.
  
      Not HarborSentinel's `alarms.ais_proximity.*`, which is a range ring around
      a boat at anchor, evaluated on the host. This one is about relative motion
      underway, so it takes the vessel-then-device scoping of the other
      chartplotter alarms.
    */
    'alarms.ais_cpa_nm': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0.01, max: 10 }),
        label: 'AIS alarm, CPA limit',
        description: 'Alarm when a target will pass closer than this.',
        placeholder: 'nautical miles',
    }),
    'alarms.ais_tcpa_min': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 1, max: 120 }),
        label: 'AIS alarm, TCPA limit',
        description: 'Only for a closest approach due within this many minutes.',
        placeholder: 'minutes',
    }),
    'alarms.heading_min_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 360 }),
        label: 'Heading alarm, from',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_hdg_min'] },
    }),
    'alarms.heading_max_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 360 }),
        label: 'Heading alarm, to',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_hdg_max'] },
    }),
    'alarms.cog_min_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 360 }),
        label: 'Course alarm, from',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_cog_min'] },
    }),
    'alarms.cog_max_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 360 }),
        label: 'Course alarm, to',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_cog_max'] },
    }),
    'alarms.awa_min_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: -180, max: 180 }),
        label: 'Apparent wind angle alarm, from',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_awa_min'] },
    }),
    'alarms.awa_max_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: -180, max: 180 }),
        label: 'Apparent wind angle alarm, to',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_awa_max'] },
    }),
    'alarms.twd_min_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 360 }),
        label: 'True wind direction alarm, from',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_twd_min'] },
    }),
    'alarms.twd_max_deg': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0, max: 360 }),
        label: 'True wind direction alarm, to',
        placeholder: 'degrees',
        legacy: { ocean: ['alarm_twd_max'] },
    }),
    /*
      The chart view: how this screen draws, rather than what it draws.
  
      Device-scoped throughout. Which base chart a screen shows, whether it is
      north-up, and how far ahead the vectors reach are facts about the screen and
      the person in front of it -- the nav station on ENC and a phone on OSM is a
      normal arrangement, not a disagreement to be resolved.
  
      The remaining three chart keys -- the overlay, layer and telemetry-panel
      toggle maps -- are deliberately NOT here. They are open records of booleans
      that gain a field whenever a layer is added, so declaring them would mean a
      shared-package edit every time OceanSentinel grows a map layer, in exchange
      for provenance nobody needs on a panel toggle.
    */
    'chart.mode': defineSetting({
        scopes: ['device'],
        type: stringType({ maxLength: 64 }),
        default: 'noaa_enc',
        label: 'Base chart',
        legacy: { ocean: ['vessel_chart_mode'], harbor: ['vessel_chart_mode'] },
    }),
    'chart.auto_select': defineSetting({
        scopes: ['device'],
        type: boolType,
        default: true,
        label: 'Follow the vessel',
        description: 'Pick the highest-authority chart covering the boat. Choosing one turns this off.',
        /*
          HarborSentinel's key is not the same string as OceanSentinel's. Both apps
          wrote this preference before the registry existed, and they named it
          differently -- checked against each repo's history rather than its current
          tree, since a legacy key is by definition one the app has stopped writing.
          The encodings differ too ('true'/'false' in ocean, '1'/'0' in harbor), and
          boolType reads both.
        */
        legacy: { ocean: ['vessel_chart_auto'], harbor: ['vessel_chart_auto_select'] },
    }),
    'chart.orientation': defineSetting({
        scopes: ['device'],
        type: oneOf(['north-up', 'heading-up']),
        default: 'north-up',
        label: 'Chart orientation',
        legacy: { ocean: ['vessel_orientation'] },
    }),
    'chart.show_vectors': defineSetting({
        scopes: ['device'],
        type: boolType,
        default: true,
        label: 'Show course vectors',
        legacy: { ocean: ['vessel_show_vectors'] },
    }),
    'chart.vector_minutes': defineSetting({
        scopes: ['device'],
        type: intType({ min: 1, max: 60 }),
        default: 10,
        label: 'Vector length',
        placeholder: 'minutes',
        legacy: { ocean: ['vessel_vector_time'] },
    }),
    'chart.show_filed_route': defineSetting({
        /*
          Whether this chart draws the passage that was filed. What the screen shows,
          not a fact about the passage, so device-scoped with the rest of the group:
          the nav station can keep the plan up while a phone in the cockpit hides it.
          OceanSentinel wrote '1'/'0', which boolType reads.
        */
        scopes: ['device'],
        type: boolType,
        default: false,
        label: 'Show the filed passage',
        legacy: { ocean: ['vessel_show_filed_route'] },
    }),
    'chart.routes_locked': defineSetting({
        /*
          Whether routes on this chart can be dragged. A guard against a stray touch
          moving a waypoint, which is a property of the screen being touched --
          unlocking the desk PC to edit a route should not unlock the phone in a
          wet cockpit. Locked is what OceanSentinel has always opened on
          (`getItem(...) !== 'false'`), and a toggle must declare one.
        */
        scopes: ['device'],
        type: boolType,
        default: true,
        label: 'Lock routes',
        legacy: { ocean: ['vessel_routes_locked'] },
    }),
    // ---------------------------------------------------------------------------
    // Position the navigator typed, for a device whose instruments are silent.
    // ---------------------------------------------------------------------------
    'position.entered_fix': defineSetting({
        /*
          One setting where OceanSentinel had two pairs of keys.
    
          `vessel_manual_fix_lat/lon` is the fix typed into the underway advisory,
          which the advisory watch also falls back on; `vessel_manual_lat/lon` was
          the settings dialog's copy, which had no input and was only ever written
          back with its seed -- `41.488 / -71.312`, a specific real boat, reaching
          every install that pressed Save. Both meant "where the boat is, according
          to a person", so they are one value, and the seed is not carried across.
    
          Device, not vessel. It exists for a device with no instrument feed, and a
          live fix always beats it; a typed position is stale from the moment it is
          entered, and syncing it would put yesterday's position on another screen
          as if it were information. No default, obviously: a guessed position is
          the one thing a chartplotter must never show.
    
          One value rather than two numbers, so a half-typed pair can never resolve
          as a position.
        */
        scopes: ['device'],
        type: shapeType('fix', {
            lat: numberType({ min: -90, max: 90 }),
            lon: numberType({ min: -180, max: 180 }),
        }),
        label: 'Entered position',
        description: 'Used only while no instrument is giving this device a position.',
        placeholder: 'latitude, longitude',
    }),
    // ---------------------------------------------------------------------------
    // The underway advisory: OceanSentinel re-checking a filed passage against the
    // latest forecast from where the boat actually is.
    // ---------------------------------------------------------------------------
    /*
      The crew's limits, which is what "above your limits" is measured against.
  
      Scoped like the alarm thresholds -- `vessel` then `device`, written at
      `device` -- and for the same reasons: what counts as too much wind is a fact
      about this boat and this crew, so a second screen should inherit it, while a
      write offshore has no connection to reach the vessel layer with.
  
      No defaults. OceanSentinel carried 30 kt, 40 kt gusting and a 4 m sea as
      literals in two files; a figure the app chose for what is dangerous is
      exactly the recommendation its "facts, not advice" decision took out. Unset
      means the advisory has not been told what trouble is, and says so. The sea
      is stored in metres whatever the display shows, like the depth alarm's feet.
  
      No legacy keys: the old value is one JSON object holding all three, which a
      rename cannot split. OceanSentinel carries it across itself.
    */
    'advisory.wind_limit_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 1, max: 100 }),
        label: 'Advisory wind limit',
        description: 'Sustained wind above this counts against the passage.',
        placeholder: 'knots',
    }),
    'advisory.gust_limit_kt': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 1, max: 150 }),
        label: 'Advisory gust limit',
        placeholder: 'knots',
    }),
    'advisory.sea_limit_m': defineSetting({
        scopes: ['vessel', 'device'],
        type: numberType({ min: 0.1, max: 30 }),
        label: 'Advisory sea limit',
        description: 'Significant wave height. Always metres, whatever the display shows.',
        placeholder: 'metres',
    }),
    'advisory.watch_hours': defineSetting({
        /*
          How often the advisory re-checks by itself; 0 is "only when I ask".
    
          Device, not vessel. Every check is two forecast-grid downloads, and on a
          satellite link that is somebody's money: arming the watch on the nav
          station must not quietly arm it on every phone on the boat as well.
    
          No default, and none needed: unset reads as off, which is what the watch
          has always been until somebody chose otherwise. OceanSentinel offers 0, 3,
          6 and 12 and ignores anything else it finds; the bounds here are looser so
          a future cadence is not a shared-package change.
        */
        scopes: ['device'],
        type: intType({ min: 0, max: 24 }),
        label: 'Check the passage by itself',
        placeholder: 'hours',
        legacy: { ocean: ['vessel_advisory_watch_hours'] },
    }),
});
