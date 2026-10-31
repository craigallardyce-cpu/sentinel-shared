import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import AlertsPanel, { WeatherAlert, WeatherData } from '../src/AlertsPanel';

/**
 * The selected alert's times, in the full-screen bulletin.
 *
 * A malformed `effective` or `ends` used to print "Invalid Date", and any alert
 * with no `ends` read "Until further notice" -- including the advisories the
 * apps infer from forecast wording, which do have an end the app does not know.
 * Severity and urgency, when absent, were filled in as "Moderate" and
 * "Immediate", which no one had said.
 */
const withAlert = (alert: WeatherAlert): WeatherData => ({
  locName: 'Block Island Sound',
  source: 'NWS',
  alerts: [alert],
  periods: [],
});

const openBulletin = (alert: WeatherAlert) => {
  render(<AlertsPanel weatherData={withAlert(alert)} lastSync={Date.now()} tempUnit="F" />);
  fireEvent.click(screen.getByText('Bulletin'));
};

describe('AlertsPanel bulletin times', () => {
  it('drops a malformed effective time rather than printing Invalid Date', () => {
    openBulletin({ event: 'Gale Warning', headline: 'x', senderName: 'NWS Boston/Norton MA', effective: 'soon', ends: 'later' });
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.queryByText('Effective')).toBeNull();
    expect(screen.getByText('Until further notice')).toBeInTheDocument();
  });

  it('prints a valid end', () => {
    const ends = '2026-10-31T22:00:00Z';
    openBulletin({ event: 'Gale Warning', headline: 'x', senderName: 'NWS Boston/Norton MA', ends });
    expect(screen.getByText(new Date(ends).toLocaleString())).toBeInTheDocument();
  });

  it('keeps "Until further notice" for an NWS alert that gives no end', () => {
    openBulletin({ event: 'Gale Warning', headline: 'x', senderName: 'NWS Boston/Norton MA' });
    expect(screen.getByText('Until further notice')).toBeInTheDocument();
  });

  it('says the end is not given for an advisory inferred from the forecast, naming the period', () => {
    openBulletin({ event: 'Small Craft Advisory', headline: 'x', severity: 'Moderate', urgency: 'Expected', forecastPeriod: 'Tonight' });
    expect(screen.queryByText('Until further notice')).toBeNull();
    expect(screen.getByText('Not given. Inferred from the forecast for Tonight')).toBeInTheDocument();
  });

  it('says "Not given" for an inferred advisory with no period, and for a missing severity or urgency', () => {
    openBulletin({ event: 'Gale Warning', headline: 'x' });
    expect(screen.queryByText('Until further notice')).toBeNull();
    expect(screen.queryByText(/Moderate|Immediate/)).toBeNull();
    expect(screen.getAllByText(/Not given/).length).toBeGreaterThanOrEqual(3);
  });
});
