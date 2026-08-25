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
export declare function formatSyncDateTime(timestamp: number | null | undefined): string;
export declare function formatTempRangeString(tempRangeStr: string | undefined, targetUnit: string): string;
