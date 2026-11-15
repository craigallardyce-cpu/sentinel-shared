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
/** What the forecast cards say for a value the forecast did not give. */
export declare const NOT_GIVEN = "Not given";
/**
 * A forecast's temperature text ("18°C to 22°C", "-5°C to 3°C", "Low 28 to high 41°F")
 * in the unit the navigator chose.
 *
 * A minus sign belongs to its number. It used to be left behind by the pattern, so
 * -5°C was converted as 5°C and shown as "-41°F", sign kept and figure wrong, and a
 * forecast of frost read as a mild day. A hyphen between two numbers ("18-22°C") is
 * still a separator. A number with no unit of its own takes the unit the text uses
 * elsewhere, and Fahrenheit only when the text names none, which is what NWS sends.
 */
export declare function formatTempRangeString(tempRangeStr: string | undefined, targetUnit: string): string;
