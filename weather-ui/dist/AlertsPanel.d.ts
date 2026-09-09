import React from 'react';
import { ForecastPeriod } from './ForecastTimeline';
export interface WeatherAlert {
    event: string;
    headline: string;
    description?: string;
    severity?: string;
    urgency?: string;
    instruction?: string;
    effective?: string;
    ends?: string;
    distance?: number;
    /**
     * Issuing NWS office, e.g. "NWS Melbourne FL", straight from the feed.
     * Deliberately optional and never defaulted: both apps also synthesise
     * advisories from forecast wording, and those have no office behind them.
     * Rendered only when present, so an inferred advisory never borrows NWS's
     * name for a call NWS did not make.
     */
    senderName?: string;
}
export interface WeatherData {
    locName?: string;
    summary?: string;
    marineZone?: string;
    source: string;
    alerts?: WeatherAlert[];
    periods: ForecastPeriod[];
}
export interface AlertsPanelProps {
    weatherData: WeatherData;
    lastSync: number | null | undefined;
    tempUnit: string;
    /**
     * Whether to offer the full-screen bulletin. Set false where the host already shows the
     * forecast in full — a button that opens a copy of what is on screen is just noise.
     */
    showBulletinButton?: boolean;
    /**
     * Whether any warning source covers this position at all.
     *
     * The fleet has exactly one warning source, NWS, and it stops at the US
     * border — six regions, see `isInsideNwsCoverage` in `@sentinel/weather`.
     * Outside them nothing is queried and `alerts` comes back empty, which is
     * indistinguishable from a genuinely quiet forecast area.
     *
     * That is the whole reason this prop exists. An empty `alerts` array used to
     * render a green **Clear** badge and the words "No active weather warnings or
     * advisories posted for this region" — an affirmative all-clear for water
     * nobody had checked. A boat in the Mediterranean was told its hazards were
     * clear by a panel that had asked no one.
     *
     * Pass `false` where the position is outside coverage and the panel says so
     * instead. **Defaults to `true`**, so a host that has not been updated keeps
     * its current behaviour rather than silently claiming no coverage.
     */
    hasWarningCoverage?: boolean;
    theme?: {
        alertsCardClass?: string;
        alertsCardAlertsActive?: string;
        alertsCardAlertsClear?: string;
        /** Card tint where no warning source covers the position; neither alarm nor all-clear. */
        alertsCardNoCoverage?: string;
        badgeActiveAlerts?: string;
        badgeClearAlerts?: string;
        /** Badge for the same state. Must not read as reassurance. */
        badgeNoCoverage?: string;
        textColorMuted?: string;
        textColorPrimary?: string;
        textColorSecondary?: string;
        textColorCyan?: string;
        textColorRed?: string;
        borderDividerClass?: string;
        bulletinBtnClass?: string;
        bulletinOverlayBgClass?: string;
        zonePanelClass?: string;
        zoneChipClass?: string;
        timelineTheme?: any;
    };
}
export default function AlertsPanel({ weatherData, lastSync, tempUnit, showBulletinButton, hasWarningCoverage, theme }: AlertsPanelProps): React.JSX.Element | null;
