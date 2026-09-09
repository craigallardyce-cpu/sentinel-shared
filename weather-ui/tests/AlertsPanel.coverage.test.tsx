import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AlertsPanel, { WeatherData } from '../src/AlertsPanel';

/**
 * What the panel says when nobody has been asked.
 *
 * The fleet has one warning source, NWS, and it stops at the US border — six
 * regions, see `isInsideNwsCoverage` in `@sentinel/weather`. Outside them
 * nothing is queried and `alerts` arrives empty, which in the data is
 * indistinguishable from a genuinely quiet forecast area.
 *
 * On screen it was not indistinguishable, it was worse: an empty array rendered
 * a green **Clear** badge, the words "No active weather warnings or advisories
 * posted for this region", and a full-screen "All Regional Hazards Clear". A
 * boat in the Mediterranean was given an affirmative all-clear by a panel that
 * had asked no one. That is the failure these cases exist to prevent, and it is
 * a safety claim rather than a copy nit, so the assertions are on the absence of
 * reassurance rather than on the presence of any particular wording.
 *
 * The default is deliberately `true`: a host that has not yet been updated keeps
 * its old behaviour rather than silently claiming it has no coverage.
 */

const QUIET: WeatherData = {
  locName: 'Golfe du Lion',
  source: 'Open-Meteo',
  alerts: [],
  periods: [],
};

const STORMY: WeatherData = {
  ...QUIET,
  alerts: [{ event: 'Gale Warning', headline: 'Gale Warning in effect' }],
};

describe('AlertsPanel outside warning coverage', () => {
  it('never shows an all-clear where no source was asked', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" hasWarningCoverage={false} />);

    expect(screen.queryByText('Clear')).toBeNull();
    expect(screen.queryByText(/No active weather warnings or advisories/i)).toBeNull();
  });

  it('says so, and says the absence is not an all-clear', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" hasWarningCoverage={false} />);

    expect(screen.getByText('No coverage')).toBeInTheDocument();
    expect(screen.getByText(/not an all-clear/i)).toBeInTheDocument();
  });

  it('points at the channel that does cover this water', () => {
    // GMDSS is the legal channel everywhere, inside the boxes as much as
    // outside. Copy that reports the gap without naming the alternative leaves
    // the reader with nothing to do about it.
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" hasWarningCoverage={false} />);

    expect(screen.getByText(/NAVTEX or SafetyNET/i)).toBeInTheDocument();
  });

  it('still shows a warning that arrives, so a wrong flag under-claims rather than hides', () => {
    // If a host passes the flag wrongly, the failure must be a needlessly
    // cautious panel, never a suppressed gale warning.
    render(<AlertsPanel weatherData={STORMY} lastSync={Date.now()} tempUnit="C" hasWarningCoverage={false} />);

    expect(screen.getByText('Gale Warning')).toBeInTheDocument();
    expect(screen.getByText(/1 ACTIVE/)).toBeInTheDocument();
    expect(screen.queryByText('No coverage')).toBeNull();
  });
});

describe('AlertsPanel inside warning coverage', () => {
  it('keeps the all-clear, which is a real statement there', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" hasWarningCoverage />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.getByText(/No active weather warnings or advisories/i)).toBeInTheDocument();
    expect(screen.queryByText('No coverage')).toBeNull();
  });

  it('defaults to covered, so an un-updated host is unchanged', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.queryByText('No coverage')).toBeNull();
  });
});
