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
    /**
     * Whether the warning check actually got an answer this refresh.
     *
     * `hasWarningCoverage` above covers the position being outside NWS. This
     * covers the other way an empty `alerts` array happens inside it: the query
     * ran and failed. `fetchNwsAlerts` in `@sentinel/weather` returned `[]` for a
     * network error, a timeout, a non-OK status and an unparseable body alike, so
     * a check that never got an answer arrived here as a quiet feed and rendered
     * the green **Clear** badge. The apps already fixed their own warning strips;
     * this is the same false all-clear one layer down.
     *
     * Pass `false` where the check failed (the package reports it as
     * `alertsStatus === 'unavailable'`) and the panel says so instead.
     * **Defaults to `true`**, so a host that has not been updated renders exactly
     * as it does today.
     */
    alertsChecked?: boolean;
    theme?: {
        alertsCardClass?: string;
        alertsCardAlertsActive?: string;
        alertsCardAlertsClear?: string;
        /**
         * Card tint for both non-answers — no warning source covers the position, and
         * the check failed. Neither is an alarm and neither is an all-clear, and they
         * are the same shade deliberately: one key rather than two so that an app
         * cannot theme one of them green.
         */
        alertsCardNoCoverage?: string;
        badgeActiveAlerts?: string;
        badgeClearAlerts?: string;
        /** Badge for both of those states. Must not read as reassurance. */
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
export default function AlertsPanel({ weatherData, lastSync, tempUnit, showBulletinButton, hasWarningCoverage, alertsChecked, theme }: AlertsPanelProps): React.JSX.Element | null;
