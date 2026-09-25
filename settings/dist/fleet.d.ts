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
export declare const FLEET_SETTINGS: import("./registry.js").Registry<{
    'vessel.name': import("./types.js").SettingSpec<string>;
    'vessel.mmsi': import("./types.js").SettingSpec<string>;
    'vessel.type': import("./types.js").SettingSpec<string>;
    'vessel.bow_roller_height_ft': import("./types.js").SettingSpec<number>;
    'units.metric': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'display.day_brightness': import("./types.js").SettingSpec<number> & {
        default: number | ((platform: import("./types.js").PlatformContext) => number);
    };
    'display.night_brightness': import("./types.js").SettingSpec<number> & {
        default: number | ((platform: import("./types.js").PlatformContext) => number);
    };
    'display.night_mode': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'display.density': import("./types.js").SettingSpec<"compact" | "comfortable">;
    'display.keep_awake': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'display.auto_dim': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'display.auto_dim_minutes': import("./types.js").SettingSpec<number> & {
        default: number | ((platform: import("./types.js").PlatformContext) => number);
    };
    'nmea.source': import("./types.js").SettingSpec<"NMEA LOCAL" | "DEVICE GPS">;
    'nmea.gateway.host': import("./types.js").SettingSpec<string>;
    'nmea.gateway.port': import("./types.js").SettingSpec<number>;
    'nmea.datahub_url': import("./types.js").SettingSpec<string>;
    'connection.backend_url': import("./types.js").SettingSpec<string>;
    'connection.pairing_token': import("./types.js").SettingSpec<string>;
    'connection.tile_proxy_url': import("./types.js").SettingSpec<string>;
    'vhf.retention_days': import("./types.js").SettingSpec<number>;
    'vhf.squelch_threshold_db': import("./types.js").SettingSpec<number>;
    'vhf.hangover_ms': import("./types.js").SettingSpec<number>;
    'vhf.monitor_audio': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'logbook.auto_interval_min': import("./types.js").SettingSpec<number>;
    'logbook.included_nmea': import("./types.js").SettingSpec<("position" | "cogSog" | "wind" | "depth" | "temp" | "battery")[]>;
    'logbook.quick_tap_presets': import("./types.js").SettingSpec<{
        id: string;
        label: string;
        text: string;
    }[]> & {
        default: {
            id: string;
            label: string;
            text: string;
        }[] | ((platform: import("./types.js").PlatformContext) => {
            id: string;
            label: string;
            text: string;
        }[]);
    };
    'logbook.instruments_range_hours': import("./types.js").SettingSpec<number> & {
        default: number | ((platform: import("./types.js").PlatformContext) => number);
    };
    'ai.model': import("./types.js").SettingSpec<string>;
    'alarms.sound_enabled': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'alarms.ais_proximity.enabled': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'alarms.ais_proximity.limit_nm': import("./types.js").SettingSpec<number>;
    'alarms.wind_limit_kt': import("./types.js").SettingSpec<number>;
    'alarms.depth_limit_ft': import("./types.js").SettingSpec<number>;
    'alarms.sog_max_kt': import("./types.js").SettingSpec<number>;
    'alarms.boat_speed_max_kt': import("./types.js").SettingSpec<number>;
    'alarms.sog_min_kt': import("./types.js").SettingSpec<number>;
    'alarms.boat_speed_min_kt': import("./types.js").SettingSpec<number>;
    'alarms.ais_cpa_nm': import("./types.js").SettingSpec<number>;
    'alarms.ais_tcpa_min': import("./types.js").SettingSpec<number>;
    'alarms.heading_min_deg': import("./types.js").SettingSpec<number>;
    'alarms.heading_max_deg': import("./types.js").SettingSpec<number>;
    'alarms.cog_min_deg': import("./types.js").SettingSpec<number>;
    'alarms.cog_max_deg': import("./types.js").SettingSpec<number>;
    'alarms.awa_min_deg': import("./types.js").SettingSpec<number>;
    'alarms.awa_max_deg': import("./types.js").SettingSpec<number>;
    'alarms.twd_min_deg': import("./types.js").SettingSpec<number>;
    'alarms.twd_max_deg': import("./types.js").SettingSpec<number>;
    'chart.mode': import("./types.js").SettingSpec<string> & {
        default: string | ((platform: import("./types.js").PlatformContext) => string);
    };
    'chart.auto_select': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'chart.orientation': import("./types.js").SettingSpec<string> & {
        default: string | ((platform: import("./types.js").PlatformContext) => string);
    };
    'chart.show_vectors': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'chart.vector_minutes': import("./types.js").SettingSpec<number> & {
        default: number | ((platform: import("./types.js").PlatformContext) => number);
    };
    'chart.show_filed_route': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'chart.routes_locked': import("./types.js").SettingSpec<boolean> & {
        default: boolean | ((platform: import("./types.js").PlatformContext) => boolean);
    };
    'position.entered_fix': import("./types.js").SettingSpec<{
        lat: number;
        lon: number;
    }>;
    'advisory.wind_limit_kt': import("./types.js").SettingSpec<number>;
    'advisory.gust_limit_kt': import("./types.js").SettingSpec<number>;
    'advisory.sea_limit_m': import("./types.js").SettingSpec<number>;
    'advisory.watch_hours': import("./types.js").SettingSpec<number>;
}>;
export type FleetSettings = typeof FLEET_SETTINGS;
