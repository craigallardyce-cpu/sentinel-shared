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
        timelineTheme?: any;
    };
}
export default function AlertsPanel({ weatherData, lastSync, tempUnit, showBulletinButton, theme }: AlertsPanelProps): React.JSX.Element | null;
