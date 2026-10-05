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
    /**
     * Names the host knows -- the forecast location (`locName`), the zone --
     * restored as written when NWS prose in capitals is put in sentence case,
     * so "NEWPORT" reads "Newport" rather than "newport".
     */
    placeNames?: readonly (string | null | undefined)[];
    theme?: {
        /** Sidebar card: surface, border, radius and padding. */
        cardBgBorder?: string;
        /** Bulletin card: surface and border colours (radius and padding are fixed). */
        bulletinCardBgBorder?: string;
        windIconClass?: string;
        textMutedClass?: string;
        textPrimaryClass?: string;
        textSecondaryClass?: string;
        textOrangeClass?: string;
        textCyanClass?: string;
        /**
         * @deprecated Ignored (fit-and-finish fixes, 2026-10-05). The bulletin card
         * is one surface: the inner box this coloured was a card inside a card.
         */
        gridBgClass?: string;
        borderDividerClass?: string;
    };
}
export default function ForecastTimeline({ periods, tempUnit, mode, placeNames, theme }: ForecastTimelineProps): React.JSX.Element | null;
