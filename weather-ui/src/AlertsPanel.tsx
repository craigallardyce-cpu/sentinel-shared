import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, X, ChevronRight, Waves, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ForecastTimeline, { ForecastPeriod } from './ForecastTimeline';
import { formatSyncDateTime } from './weatherUtils';
import { nwsSentenceCase } from './nwsText';

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

export default function AlertsPanel({ 
  weatherData, 
  lastSync, 
  tempUnit,
  showBulletinButton = true,
  hasWarningCoverage = true,
  alertsChecked = true,
  theme
}: AlertsPanelProps) {
  const [showBulletin, setShowBulletin] = useState(false);
  const [selectedAlertIndex, setSelectedAlertIndex] = useState(0);

  if (!weatherData) return null;

  const hasAlerts = weatherData.alerts && weatherData.alerts.length > 0;
  /*
    Four states, not two. "No warnings", "no warning source" and "the check
    failed" are one empty array in the data and must never be one thing on
    screen: only the first is an all-clear. An active warning still shows
    through ahead of all of them, so a host that passes either flag wrongly
    under-claims rather than hides a hazard.

    A failed check outranks absent coverage on purpose. Both are non-answers, so
    the order only decides which sentence a reader gets when a host passes both
    flags false; the failed check is the more specific thing to have happened,
    and the coverage copy would assert something this panel does not know.
  */
  const alertsUnchecked = !hasAlerts && !alertsChecked;
  const noCoverage = !hasAlerts && !alertsUnchecked && !hasWarningCoverage;
  /* The two non-answers share the card tint and the muted badge; only the copy differs. */
  const noAnswer = alertsUnchecked || noCoverage;


  /*
    Fit-and-finish (2026-09-30) did not reach this panel either; the catalogue
    re-shoot found it in the old house style next to ForecastTimeline. It
    follows the system now: sentence-case `text-label` labels, Inter for words
    and mono only for times and numbers, nothing under 13px, radius 8 for a
    control and 16 for a surface, no glows or coloured shadows, and nothing
    pulses (only alarms do, and an NWS warning is a warning, not this app's
    alarm). Facts are never cut with an ellipsis: an alert's name and the report
    area wrap instead.

    Two lines of copy went with the restyle because they asserted checks
    nothing performs: "Sync Integrity: Pass" under the bulletin title, and
    "INTEGRITY CHECK: PASS" with "Raw Data Relay" at its foot. The bulletin now
    names its source and when it was fetched, which is what those lines were
    standing in for.
  */
  const alertsCardClass = theme?.alertsCardClass || 'p-4 rounded-xl border flex flex-col gap-3 relative overflow-hidden';
  const alertsCardAlertsActive = theme?.alertsCardAlertsActive || 'bg-red/5 border-red/30';
  const alertsCardAlertsClear = theme?.alertsCardAlertsClear || 'bg-green/5 border-green/20';
  const badgeActiveAlerts = theme?.badgeActiveAlerts || 'bg-red/10 border-red/30 text-red';
  const badgeClearAlerts = theme?.badgeClearAlerts || 'text-green bg-green/10 border-green/20';
  const alertsCardNoCoverage = theme?.alertsCardNoCoverage || 'bg-warning/5 border-warning/20';
  const badgeNoCoverage = theme?.badgeNoCoverage || 'text-warning bg-warning/10 border-warning/30';
  const textColorMuted = theme?.textColorMuted || 'text-text-muted';
  const textColorPrimary = theme?.textColorPrimary || 'text-text-primary';
  const textColorSecondary = theme?.textColorSecondary || 'text-text-secondary';
  const textColorCyan = theme?.textColorCyan || 'text-cyan';
  const textColorRed = theme?.textColorRed || 'text-red';
  const borderDividerClass = theme?.borderDividerClass || 'border-border-color/20';
  const borderDividerClassThick = theme?.borderDividerClass || 'border-border-color/30';
  const bulletinBtnClass = theme?.bulletinBtnClass || 'text-cyan hover:text-cyan/80 bg-bg-card border border-border-color hover:border-text-muted';
  const bulletinOverlayBgClass = theme?.bulletinOverlayBgClass || 'bg-bg-app';
  const zonePanelClass = theme?.zonePanelClass || 'bg-bg-card border-border-color/30';
  const zoneChipClass = theme?.zoneChipClass || 'text-cyan bg-cyan/10 border-cyan/20';

  const BADGE = 'inline-flex items-center gap-1 h-6 px-2 rounded-full border text-label whitespace-nowrap';
  const SECTION_TITLE = `text-headline-md ${textColorPrimary}`;
  const selected = hasAlerts ? weatherData.alerts![selectedAlertIndex] : undefined;
  const when = (iso: string) => new Date(iso).toLocaleString();
  /* The place and zone this panel already shows, so NWS capitals text names
     them as written ("Block Island Sound", not "block island sound"). */
  const placeNames = [weatherData.locName, weatherData.marineZone];

  return (
    <>
      {/* Marine Alerts Card */}
      <div className={`${alertsCardClass} ${hasAlerts ? alertsCardAlertsActive : noAnswer ? alertsCardNoCoverage : alertsCardAlertsClear}`}>
        <div className={`flex flex-col gap-1.5 border-b pb-2 ${borderDividerClass}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-label ${textColorMuted}`}>Marine warnings</span>
            <div className="flex items-center gap-1.5">
              {hasAlerts ? (
                <span className={`${BADGE} ${badgeActiveAlerts}`}>
                  <ShieldAlert size={16} strokeWidth={1.75} aria-hidden className={textColorRed} />
                  <span>{weatherData.alerts!.length} active</span>
                </span>
              ) : alertsUnchecked ? (
                <span className={`${BADGE} ${badgeNoCoverage}`}>Not checked</span>
              ) : noCoverage ? (
                <span className={`${BADGE} ${badgeNoCoverage}`}>No coverage</span>
              ) : (
                <span className={`${BADGE} ${badgeClearAlerts}`}>Clear</span>
              )}
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className={`text-label shrink-0 ${textColorMuted}`}>Report area</span>
            <span className={`text-body-sm font-semibold text-right min-w-0 break-words ${textColorCyan}`}>
              {weatherData.locName || 'Coastal area'}
            </span>
          </div>
        </div>

        <div className={`text-body-sm text-left ${hasAlerts ? textColorRed : textColorMuted}`}>
          {hasAlerts ? (
            <ul className="space-y-1">
              {weatherData.alerts!.slice(0, 2).map((alert, i) => (
                <li key={i} className={`flex items-start gap-1.5 ${textColorRed}`}>
                  <span className="shrink-0" aria-hidden>•</span>
                  <span className="min-w-0 break-words">{alert.event}</span>
                </li>
              ))}
              {weatherData.alerts!.length > 2 && (
                <li className={textColorMuted}>
                  <span className="font-mono">+{weatherData.alerts!.length - 2}</span> more warnings active
                </li>
              )}
            </ul>
          ) : alertsUnchecked ? (
            /* Deliberately not the no-coverage wording below: that says NWS does not
               cover this position, which here would be untrue. The check was made and
               it failed, and the panel says only that. */
            <p>
              Couldn't check for warnings — this is not an all-clear. Warnings may be in force; the app will try again at the next refresh.
            </p>
          ) : noCoverage ? (
            <p>
              No warning service covers this position. This is not an all-clear — warnings may be in force and this app cannot see them. Use NAVTEX or SafetyNET.
            </p>
          ) : (
            <p>No active weather warnings or advisories posted for this region.</p>
          )}
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-2 pt-2 border-t ${borderDividerClassThick}`}>
          <div className="flex flex-col min-w-0 text-left text-body-sm">
            <span className={`break-words ${textColorMuted}`}>{weatherData.source}</span>
            <span className={hasAlerts ? textColorRed : textColorMuted}>
              Updated <span className="font-mono">{formatSyncDateTime(lastSync)}</span>
            </span>
          </div>
          {showBulletinButton && (
            <button
              type="button"
              onClick={() => { setSelectedAlertIndex(0); setShowBulletin(true); }}
              className={`h-10 px-3 rounded-md text-label cursor-pointer transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)] ${bulletinBtnClass}`}
            >
              Bulletin
            </button>
          )}
        </div>
      </div>

      {/* ─── FULL-SCREEN BULLETIN OVERLAY (Portal) ──────────────────────── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showBulletin && (
            <motion.div
              key="weather-bulletin-overlay"
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              /* sentinel-titlebar-safe: this is a full-bleed overlay outside the
                 shell, so nothing else is keeping its header clear of the OS
                 window-controls cluster. Without it the close button below sits
                 under that cluster on desktop and only half of it is pressable. */
              className={`fixed inset-0 z-[9999] flex flex-col overflow-hidden sentinel-titlebar-safe ${bulletinOverlayBgClass} ${textColorPrimary}`}
            >
              <header className={`px-4 sm:px-6 py-3 border-b flex items-center justify-between gap-3 shrink-0 select-none ${borderDividerClassThick}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <Waves className={`shrink-0 ${hasAlerts ? textColorRed : textColorCyan}`} size={20} strokeWidth={1.75} aria-hidden />
                  <div className="flex flex-col text-left min-w-0">
                    <h2 className="text-headline-md">Weather bulletin</h2>
                    <span className={`text-body-sm break-words ${textColorMuted}`}>
                      {[weatherData.locName, weatherData.source].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowBulletin(false)}
                  aria-label="Close bulletin"
                  title="Close"
                  className={`h-12 w-12 shrink-0 flex items-center justify-center rounded-md cursor-pointer transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)] ${bulletinBtnClass}`}
                >
                  <X size={20} strokeWidth={1.75} aria-hidden />
                </button>
              </header>

              <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 custom-scrollbar">
                <div className="flex flex-col gap-12 w-full max-w-5xl mx-auto">

                {/* Which area this bulletin actually covers.
                    Rendered only when the feed supplied both the place and the zone. It has no
                    defaults on purpose: the version this replaced in HarborSentinel fell back to
                    "Rhode Island Sound" / "ANZ235" and printed a fixed NOAA regional office, so a
                    vessel anywhere else was told, confidently, that its forecast came from southern
                    New England. An absent header is the honest answer; a guessed one is not. The
                    third line is `source`, which the feed does supply, rather than a coverage-area
                    description nothing reports. */}
                {weatherData.locName && weatherData.marineZone && (
                  <section className={`p-4 sm:p-6 rounded-xl border text-left ${zonePanelClass}`}>
                    <span className={`block text-label ${textColorMuted}`}>Reporting area centre</span>
                    <h3 className="mt-1 text-headline-lg break-words">{weatherData.locName}</h3>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <span className={`inline-flex items-center h-6 px-2 rounded-full border text-label whitespace-nowrap ${zoneChipClass}`}>
                        Zone&nbsp;<span className="font-mono font-medium">{weatherData.marineZone}</span>
                      </span>
                      <span className={`text-body-sm ${textColorMuted}`}>{weatherData.source}</span>
                    </div>
                  </section>
                )}

                {/* ACTIVE NWS WARNINGS/ALERTS */}
                <section className="flex flex-col gap-4">
                  <h3 className={SECTION_TITLE}>Active marine hazards</h3>

                  {hasAlerts ? (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 items-stretch">

                      {/* Left: the alerts, one control each */}
                      <div className="md:col-span-4 flex flex-col gap-2">
                        {weatherData.alerts!.map((alert, i) => (
                          /* Selection is a stroke and the accent word, not a
                             red fill: a red-filled button reads as "acknowledge
                             the alarm", which is Button's alarm variant's job. */
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSelectedAlertIndex(i)}
                            aria-pressed={selectedAlertIndex === i}
                            className={`p-3 rounded-md border text-left cursor-pointer transition-colors duration-[var(--motion-state)] ease-[var(--motion-ease)] ${
                              selectedAlertIndex === i
                                ? 'bg-bg-card border-red/60 text-red'
                                : 'bg-bg-card/40 border-border-color/30 hover:border-border-color text-text-secondary hover:text-text-primary'
                            }`}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-body-md font-semibold break-words min-w-0">{alert.event}</span>
                              <ChevronRight className="shrink-0 mt-0.5" size={16} strokeWidth={1.75} aria-hidden />
                            </span>
                            <span className="block text-body-sm text-text-muted">
                              Severity: {alert.severity || 'Moderate'}
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* Right: the selected alert in full */}
                      <div className="md:col-span-8 flex flex-col">
                        {selected && (
                          <motion.article
                            key={selectedAlertIndex}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                            className="p-4 sm:p-6 bg-red/5 border border-red/30 rounded-xl flex-1 flex flex-col gap-6 text-left"
                          >
                            <header className={`flex flex-col gap-1 border-b pb-3 ${borderDividerClass}`}>
                              <h4 className={`text-headline-md break-words ${textColorRed}`}>{selected.event}</h4>
                              <span className={`text-body-sm ${textColorMuted}`} title={selected.headline}>
                                {nwsSentenceCase(selected.headline, { names: placeNames })}
                              </span>
                              {selected.senderName && (
                                <span className={`text-body-sm ${textColorSecondary}`}>
                                  Issued by {selected.senderName}
                                </span>
                              )}
                            </header>

                            {/* An NWS alert description is several paragraphs of
                                plain English, often in capitals. Inter 15/400 in
                                sentence case, with the original in its title. */}
                            <div className="flex flex-col gap-1.5">
                              <span className={`text-label ${textColorMuted}`}>Description</span>
                              <p
                                className={`text-body-md whitespace-pre-line select-text overflow-y-auto max-h-64 custom-scrollbar ${textColorSecondary}`}
                                title={selected.description || undefined}
                              >
                                {selected.description ? nwsSentenceCase(selected.description, { names: placeNames }) : 'No description provided.'}
                              </p>
                            </div>

                            {selected.instruction && (
                              <div className="flex flex-col gap-1.5">
                                <span className={`text-label ${textColorMuted}`}>Precautionary actions</span>
                                <p className="text-body-md whitespace-pre-line text-warning" title={selected.instruction}>
                                  {nwsSentenceCase(selected.instruction, { names: placeNames })}
                                </p>
                              </div>
                            )}

                            <dl className={`grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t ${borderDividerClass}`}>
                              <div className="flex flex-col gap-1">
                                <dt className={`text-label ${textColorMuted}`}>Severity</dt>
                                <dd className={`text-body-md font-semibold ${textColorRed}`}>{selected.severity || 'Moderate'}</dd>
                              </div>
                              <div className="flex flex-col gap-1">
                                <dt className={`text-label ${textColorMuted}`}>Urgency</dt>
                                <dd className={`text-body-md font-semibold ${textColorSecondary}`}>{selected.urgency || 'Immediate'}</dd>
                              </div>
                              {selected.effective && (
                                <div className="flex flex-col gap-1">
                                  <dt className={`text-label ${textColorMuted}`}>Effective</dt>
                                  <dd className={`text-data-mono-lg ${textColorSecondary}`}>{when(selected.effective)}</dd>
                                </div>
                              )}
                              <div className="flex flex-col gap-1">
                                <dt className={`text-label ${textColorMuted}`}>Effective until</dt>
                                <dd className={selected.ends ? `text-data-mono-lg ${textColorSecondary}` : `text-body-md ${textColorSecondary}`}>
                                  {selected.ends ? when(selected.ends) : 'Until further notice'}
                                </dd>
                              </div>
                            </dl>
                          </motion.article>
                        )}
                      </div>

                    </div>
                  ) : (
                    alertsUnchecked ? (
                      <div className="p-6 bg-warning/5 border border-warning/30 rounded-xl flex flex-col gap-2 text-left select-none">
                        <Info className="w-5 h-5 text-warning" strokeWidth={1.75} aria-hidden />
                        <h4 className="text-headline-md text-warning">Warnings not checked</h4>
                        <p className={`text-body-md ${textColorSecondary}`}>
                          Couldn't check for warnings — this is not an all-clear. Warnings may be in force; the app will try again at the next refresh.
                        </p>
                      </div>
                    ) : noCoverage ? (
                      <div className="p-6 bg-warning/5 border border-warning/30 rounded-xl flex flex-col gap-2 text-left select-none">
                        <Info className="w-5 h-5 text-warning" strokeWidth={1.75} aria-hidden />
                        <h4 className="text-headline-md text-warning">Outside warning coverage</h4>
                        <p className={`text-body-md ${textColorSecondary}`}>
                          Severe-weather warnings come from the US National Weather Service and are only available in US waters. This position is outside them, so no warning service was asked and none can be shown.
                        </p>
                        <p className={`text-body-md ${textColorSecondary}`}>
                          An empty panel here does not mean the water is clear. NAVTEX and SafetyNET under the GMDSS are the official channel for maritime safety information, and nothing in this app replaces a receiver.
                        </p>
                      </div>
                    ) : (
                    <div className="p-6 bg-green/5 border border-green/20 rounded-xl flex flex-col gap-2 text-left select-none">
                      <Waves className="w-5 h-5 text-green" strokeWidth={1.75} aria-hidden />
                      <h4 className="text-headline-md text-green">All regional hazards clear</h4>
                      <p className={`text-body-md ${textColorSecondary}`}>
                        No active small craft advisories, gale warnings, or storm alerts are currently posted for this area.
                      </p>
                    </div>
                    )
                  )}
                </section>

                {/* The forecast, period by period */}
                <section className="flex flex-col gap-4">
                  <h3 className={SECTION_TITLE}>Period forecasts</h3>
                  <ForecastTimeline
                    periods={weatherData.periods}
                    tempUnit={tempUnit}
                    mode="bulletin"
                    placeNames={placeNames}
                    theme={theme?.timelineTheme}
                  />
                </section>

                <p className={`text-body-sm text-left ${textColorMuted}`}>
                  Source: {weatherData.source}
                </p>
                </div>
              </main>

              {/* Carries when the forecast was fetched, and nothing else.
                  This was a live wall clock labelled UTC, which was wrong twice over:
                  toLocaleTimeString renders the viewer's *local* time, and the periods
                  above are named in local terms ("Tonight", "Friday"), so a UTC stamp
                  under them invited arithmetic errors. What matters here is the age of
                  the forecast, not the time of day. formatSyncDateTime is the same
                  helper the collapsed card uses, so the two now agree. */}
              <footer className={`px-4 sm:px-6 py-3 border-t flex items-center justify-end shrink-0 text-body-sm select-none bg-bg-panel ${borderDividerClass} ${textColorMuted}`}>
                <span>Synced <span className="font-mono">{formatSyncDateTime(lastSync)}</span></span>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
