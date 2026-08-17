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
export default function AlertsPanel({ weatherData, lastSync, tempUnit, theme }: AlertsPanelProps): React.JSX.Element | null;
