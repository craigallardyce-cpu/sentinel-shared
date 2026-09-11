export declare const directionToDegrees: Record<string, number>;
export declare function getWindRotation(dirStr: string | undefined): number;
export declare function getHighestWindValue(windRange: string | undefined): number;
export interface WeatherIconTheme {
    thunderstorm?: string;
    rain?: string;
    snow?: string;
    fog?: string;
    cloudySun?: string;
    sunny?: string;
    cloudy?: string;
    default?: string;
}
export declare function getWeatherIcon(reasonText: string | undefined, theme?: WeatherIconTheme): {
    Icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
    color: string;
};
/**
 * When the forecast last landed, at the precision anyone reads it to.
 *
 * This used to render "Sep 11, 2026 12:41:49" under every forecast panel. The
 * date is almost always today and the seconds were never the question — the
 * question is "is this current", which a time answers. The date comes back only
 * once the reading is old enough for it to matter.
 */
export declare function formatSyncDateTime(timestamp: number | null | undefined): string;
export declare function formatTempRangeString(tempRangeStr: string | undefined, targetUnit: string): string;
