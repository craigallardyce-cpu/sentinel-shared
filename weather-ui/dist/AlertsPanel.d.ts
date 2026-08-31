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
    theme?: {
        alertsCardClass?: string;
        alertsCardAlertsActive?: string;
        alertsCardAlertsClear?: string;
        badgeActiveAlerts?: string;
        badgeClearAlerts?: string;
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
export default function AlertsPanel({ weatherData, lastSync, tempUnit, showBulletinButton, theme }: AlertsPanelProps): React.JSX.Element | null;
