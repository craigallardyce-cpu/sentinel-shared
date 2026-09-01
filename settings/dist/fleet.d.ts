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
export declare const FLEET_SETTINGS: import("./registry.js").Registry<{
    'vessel.name': import("./types.js").SettingSpec<string>;
    'vessel.mmsi': import("./types.js").SettingSpec<string>;
    'vessel.type': import("./types.js").SettingSpec<string>;
    'vessel.bow_roller_height_ft': import("./types.js").SettingSpec<number>;
    'units.metric': import("./types.js").SettingSpec<boolean>;
    'display.day_brightness': import("./types.js").SettingSpec<number>;
    'display.night_brightness': import("./types.js").SettingSpec<number>;
    'display.keep_awake': import("./types.js").SettingSpec<boolean>;
    'display.auto_dim': import("./types.js").SettingSpec<boolean>;
    'display.auto_dim_minutes': import("./types.js").SettingSpec<number>;
    'nmea.source': import("./types.js").SettingSpec<string>;
    'nmea.gateway.host': import("./types.js").SettingSpec<string>;
    'nmea.gateway.port': import("./types.js").SettingSpec<number>;
    'nmea.remote.host': import("./types.js").SettingSpec<string>;
    'nmea.remote.port': import("./types.js").SettingSpec<number>;
    'nmea.datahub_url': import("./types.js").SettingSpec<string>;
    'connection.backend_url': import("./types.js").SettingSpec<string>;
    'connection.tile_proxy_url': import("./types.js").SettingSpec<string>;
    'alarms.ais_proximity.enabled': import("./types.js").SettingSpec<boolean>;
    'alarms.ais_proximity.limit_nm': import("./types.js").SettingSpec<number>;
    'alarms.wind_limit_kt': import("./types.js").SettingSpec<number>;
    'alarms.depth_limit_ft': import("./types.js").SettingSpec<number>;
}>;
export type FleetSettings = typeof FLEET_SETTINGS;
