import React from 'react';
export interface ForecastPeriod {
    periodName: string;
    windRange: string;
    windDirection?: string;
    tempRange?: string;
    precipChance?: string;
    reason?: string;
    riskLevel?: string;
    startTime?: string;
    endTime?: string;
}
export interface ForecastTimelineProps {
    periods: ForecastPeriod[];
    tempUnit: string;
    mode?: 'sidebar' | 'bulletin';
    theme?: {
        cardBgBorder?: string;
        bulletinCardBgBorder?: string;
        windIconClass?: string;
        textMutedClass?: string;
        textPrimaryClass?: string;
        textSecondaryClass?: string;
        textOrangeClass?: string;
        textCyanClass?: string;
        gridBgClass?: string;
        borderDividerClass?: string;
    };
}
export default function ForecastTimeline({ periods, tempUnit, mode, theme }: ForecastTimelineProps): React.JSX.Element | null;
