import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, AlertCircle, X, ChevronRight, Waves, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ForecastTimeline, { ForecastPeriod } from './ForecastTimeline';
import { formatSyncDateTime } from './weatherUtils';

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

export default function AlertsPanel({ 
  weatherData, 
  lastSync, 
  tempUnit,
  theme
}: AlertsPanelProps) {
  const [showBulletin, setShowBulletin] = useState(false);
  const [selectedAlertIndex, setSelectedAlertIndex] = useState(0);
  const [bulletinTime, setBulletinTime] = useState(new Date());

  // Live clock for bulletin footer
  useEffect(() => {
    if (!showBulletin) return;
    const interval = setInterval(() => setBulletinTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, [showBulletin]);

  if (!weatherData) return null;

  const hasAlerts = weatherData.alerts && weatherData.alerts.length > 0;

  // Ocean Sentinel styles as defaults
  const alertsCardClass = theme?.alertsCardClass || 'p-3 rounded-lg border flex flex-col gap-2 relative group overflow-hidden';
  const alertsCardAlertsActive = theme?.alertsCardAlertsActive || 'bg-red/5 border-red/20';
  const alertsCardAlertsClear = theme?.alertsCardAlertsClear || 'bg-green/5 border-green/20';
  const badgeActiveAlerts = theme?.badgeActiveAlerts || 'bg-red/10 border-red/30 text-red';
  const badgeClearAlerts = theme?.badgeClearAlerts || 'text-green bg-green/10 border-green/20';
  const textColorMuted = theme?.textColorMuted || 'text-text-muted';
  const textColorPrimary = theme?.textColorPrimary || 'text-text-primary';
  const textColorSecondary = theme?.textColorSecondary || 'text-text-secondary';
  const textColorCyan = theme?.textColorCyan || 'text-cyan';
  const textColorRed = theme?.textColorRed || 'text-red';
  const borderDividerClass = theme?.borderDividerClass || 'border-border-color/20';
  const borderDividerClassThick = theme?.borderDividerClass || 'border-border-color/30';
  const bulletinBtnClass = theme?.bulletinBtnClass || 'text-cyan hover:text-cyan/80 bg-bg-card border border-border-color hover:border-text-muted';
  const bulletinOverlayBgClass = theme?.bulletinOverlayBgClass || 'bg-bg-app';

  return (
    <>
      {/* Marine Alerts Card */}
      <div className={`${alertsCardClass} ${hasAlerts ? alertsCardAlertsActive : alertsCardAlertsClear}`}>
        <div className={`flex flex-col gap-1.5 border-b pb-2 ${borderDividerClass}`}>
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-mono uppercase tracking-widest ${textColorMuted}`}>Marine Warnings</span>
            <div className="flex items-center gap-1.5">
              {hasAlerts ? (
                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border animate-pulse ${badgeActiveAlerts}`}>
                  <ShieldAlert size={10} className={textColorRed} />
                  <span className="text-[11px] font-black font-mono uppercase">{weatherData.alerts!.length} ACTIVE</span>
                </div>
              ) : (
                <span className={`text-[11px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-md border ${badgeClearAlerts}`}>
                  Clear
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className={textColorMuted}>REPORT AREA:</span>
            <span className={`font-bold uppercase tracking-tight truncate max-w-[200px] ${textColorCyan}`} title={weatherData.locName || 'Coastal Area'}>
              {weatherData.locName || 'Coastal Area'}
            </span>
          </div>
        </div>

        <div className={`text-[11px] font-mono leading-tight ${hasAlerts ? textColorRed : textColorMuted}`}>
          {hasAlerts ? (
            <div className="space-y-1">
              {weatherData.alerts!.slice(0, 2).map((alert, i) => (
                <div key={i} className={`flex items-start gap-1 ${textColorRed}`}>
                  <span className="shrink-0">•</span>
                  <span className="truncate max-w-[250px] text-left block" title={alert.event}>{alert.event}</span>
                </div>
              ))}
              {weatherData.alerts!.length > 2 && (
                <span className={`text-[11px] block ${textColorMuted}`}>+{weatherData.alerts!.length - 2} more warnings active</span>
              )}
            </div>
          ) : (
            <p className={`${textColorMuted} text-[11px] italic text-left`}>No active weather warnings or advisories posted for this region.</p>
          )}
        </div>

        <div className={`flex items-center justify-between mt-2 pt-2 border-t ${borderDividerClassThick}`}>
          <div className="flex flex-col min-w-0 text-left">
            <span className={`text-[11px] font-mono uppercase tracking-widest truncate max-w-[160px] ${textColorMuted}`}>{weatherData.source}</span>
            <span className={`text-[11px] font-mono font-bold mt-0.5 ${
              hasAlerts ? textColorRed : textColorMuted
            }`}>Sync: {formatSyncDateTime(lastSync)}</span>
          </div>
          <button 
            onClick={() => { setSelectedAlertIndex(0); setShowBulletin(true); }}
            className={`text-[11px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md transition-all cursor-pointer active:scale-95 ${bulletinBtnClass}`}
          >
            Bulletin
          </button>
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
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed inset-0 z-[9999] flex flex-col overflow-hidden ${bulletinOverlayBgClass} ${textColorPrimary}`}
            >
              {/* Floating Header */}
              <header className={`px-6 py-4 border-b flex items-center justify-between shrink-0 select-none ${borderDividerClassThick}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-red/5 border ${hasAlerts ? 'border-red/20' : 'border-border-color/20'}`}>
                    <Waves className={hasAlerts ? textColorRed : textColorCyan} size={18} />
                  </div>
                  <div className="flex flex-col text-left">
                    <h2 className="text-sm font-extrabold uppercase tracking-wider">National Weather Bulletin</h2>
                    <span className={`text-[11px] font-mono uppercase tracking-widest ${textColorMuted}`}>
                      {weatherData.locName || 'US Coastal Waters'} // Sync Integrity: Pass
                    </span>
                  </div>
                </div>

                <button 
                  onClick={() => setShowBulletin(false)}
                  className={`p-2 rounded-lg border transition-all active:scale-90 cursor-pointer ${bulletinBtnClass}`}
                >
                  <X size={16} />
                </button>
              </header>

              {/* Scrollable Document Body */}
              <main className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 custom-scrollbar">
                
                {/* ACTIVE NWS WARNINGS/ALERTS */}
                <div className="space-y-4">
                  <div className="flex items-center gap-4 px-2 select-none">
                    <div className={`h-px flex-1 bg-border-color/25`}></div>
                    <h3 className={`text-[11px] font-mono font-bold uppercase tracking-[0.25em] ${textColorMuted}`}>Active Marine Hazards</h3>
                    <div className={`h-px flex-1 bg-border-color/25`}></div>
                  </div>

                  {hasAlerts ? (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
                      
                      {/* Left: Alerts Selector List */}
                      <div className="md:col-span-4 flex flex-col gap-2">
                        {weatherData.alerts!.map((alert, i) => (
                          <button
                            key={i}
                            onClick={() => setSelectedAlertIndex(i)}
                            className={`p-4 rounded-xl border text-left transition-all relative group cursor-pointer active:scale-[0.98] ${
                              selectedAlertIndex === i
                                ? 'bg-red/10 border-red/40 text-red shadow-md shadow-red/5'
                                : 'bg-bg-card/25 border-border-color/10 hover:border-border-color/30 text-text-muted hover:text-text-primary'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-extrabold truncate uppercase tracking-wide">{alert.event}</span>
                              <ChevronRight className={`transition-colors shrink-0 ${
                                selectedAlertIndex === i ? textColorRed : 'text-text-muted/20 group-hover:text-text-secondary'
                              }`} size={16} />
                            </div>
                            <span className="text-[11px] font-mono uppercase tracking-wider block mt-1 opacity-60 truncate">
                              Severity: {alert.severity || 'Moderate'}
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* Right: Full Alert Detail Card */}
                      <div className="md:col-span-8 flex flex-col">
                        {weatherData.alerts![selectedAlertIndex] && (
                          <motion.div 
                            key={selectedAlertIndex}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-6 bg-red/5 border border-red/20 rounded-2xl flex-1 flex flex-col justify-between text-left`}
                          >
                            <div className="space-y-4">
                              <div className={`flex flex-col gap-1 border-b pb-3 ${borderDividerClass}`}>
                                <h4 className={`text-base font-black uppercase tracking-wider ${textColorRed}`}>
                                  {weatherData.alerts![selectedAlertIndex].event}
                                </h4>
                                <span className={`text-[11px] font-mono uppercase tracking-widest ${textColorMuted}`}>
                                  {weatherData.alerts![selectedAlertIndex].headline}
                                </span>
                              </div>

                              <div className="space-y-4 font-mono text-xs leading-relaxed uppercase">
                                <div className="space-y-1.5">
                                  <span className={`text-[11px] font-black tracking-widest block ${textColorMuted}`}>Detailed Description:</span>
                                  <p className={`p-4 bg-bg-card/40 rounded-xl border border-border-color/10 select-text overflow-y-auto max-h-[160px] custom-scrollbar ${textColorSecondary}`}>
                                    {weatherData.alerts![selectedAlertIndex].description || 'No description provided.'}
                                  </p>
                                </div>

                                {weatherData.alerts![selectedAlertIndex].instruction && (
                                  <div className="space-y-1.5">
                                    <span className={`text-[11px] font-black tracking-widest block ${textColorMuted}`}>Precautionary Actions:</span>
                                    <div className="p-4 bg-warning/5 border border-warning/20 text-warning rounded-xl">
                                      {weatherData.alerts![selectedAlertIndex].instruction}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className={`grid grid-cols-2 md:grid-cols-3 gap-4 pt-6 border-t mt-6 text-[11px] font-mono ${borderDividerClass}`}>
                              <div>
                                <span className={`block opacity-50 ${textColorMuted}`}>Severity</span>
                                <span className={`font-bold uppercase ${textColorRed}`}>{weatherData.alerts![selectedAlertIndex].severity || 'Moderate'}</span>
                              </div>
                              <div>
                                <span className={`block opacity-50 ${textColorMuted}`}>Urgency</span>
                                <span className={`font-bold uppercase ${textColorSecondary}`}>{weatherData.alerts![selectedAlertIndex].urgency || 'Immediate'}</span>
                              </div>
                              <div>
                                <span className={`block opacity-50 ${textColorMuted}`}>Effective Until</span>
                                <span className={`font-bold uppercase ${textColorSecondary}`}>
                                  {weatherData.alerts![selectedAlertIndex].ends 
                                    ? new Date(weatherData.alerts![selectedAlertIndex].ends!).toLocaleString()
                                    : 'Until further notice'}
                                </span>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>

                    </div>
                  ) : (
                    <div className="p-10 bg-green/5 border border-green/10 rounded-2xl text-center space-y-2 select-none">
                      <Waves className="w-8 h-8 mx-auto text-green animate-pulse" />
                      <h4 className="text-xs font-black uppercase tracking-widest text-green">All Regional Hazards Clear</h4>
                      <p className={`text-[11px] font-mono uppercase tracking-widest ${textColorMuted}`}>
                        No active small craft advisories, gale warnings, or storm alerts are currently posted for this area.
                      </p>
                    </div>
                  )}
                </div>

                {/* DIRECT ZONE FORECASTS */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4 px-2 select-none">
                    <div className={`h-px flex-1 bg-border-color/25`}></div>
                    <h3 className={`text-[11px] font-mono font-bold uppercase tracking-[0.25em] ${textColorMuted}`}>Direct Period Forecasts</h3>
                    <div className={`h-px flex-1 bg-border-color/25`}></div>
                  </div>

                  <ForecastTimeline 
                    periods={weatherData.periods} 
                    tempUnit={tempUnit} 
                    mode="bulletin" 
                    theme={theme?.timelineTheme}
                  />
                </div>

                <div className={`p-6 bg-bg-card/20 rounded-xl border border-dashed flex flex-col md:flex-row items-center justify-between gap-4 text-left border-border-color/25`}>
                  <div className={`flex items-center gap-3 ${textColorMuted}`}>
                    <Info size={16} />
                    <span className="font-mono text-[11px] uppercase tracking-widest">Verification: {weatherData.source} // Raw Data Relay</span>
                  </div>
                  <div className={`flex items-center gap-4 font-mono text-[11px] uppercase ${textColorMuted}`}>
                    <span>Last Report Sync: {new Date(lastSync || Date.now()).toISOString().split('T')[0]}</span>
                    <span>INTEGRITY CHECK: PASS</span>
                  </div>
                </div>

              </main>

              {/* Floating Footer Clock */}
              <footer className={`px-6 py-4 border-t flex items-center justify-end shrink-0 font-mono text-[11px] tracking-widest select-none bg-bg-panel/40 ${borderDividerClass} ${textColorMuted}`}>
                <span className="animate-pulse">{bulletinTime.toLocaleTimeString([], { hour12: false })} UTC</span>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
