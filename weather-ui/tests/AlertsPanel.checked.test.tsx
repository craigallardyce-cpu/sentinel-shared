import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import AlertsPanel, { WeatherData } from '../src/AlertsPanel';

/**
 * What the panel says when the warning check failed.
 *
 * Sibling of `AlertsPanel.coverage.test.tsx`, and the same class of bug one
 * refresh later rather than one position over. `fetchNwsAlerts` in
 * `@sentinel/weather` used to return `[]` for a network error, its 2s timeout, a
 * non-OK status and an unparseable body alike, so a check that got no answer
 * reached this panel as a quiet feed — green **Clear** badge, "No active weather
 * warnings or advisories posted for this region", and a full-screen "All
 * Regional Hazards Clear". The package now reports `alertsStatus`
 * (sentinel-shared #74) and the apps' own warning strips already say so; this
 * prop is the panel under those strips.
 *
 * The assertions are on the absence of reassurance as much as on the new
 * wording, because the safety claim is the absence: a green badge over an
 * unanswered query is the failure, whatever words sit beside it.
 */

const QUIET: WeatherData = {
  locName: 'Block Island Sound',
  source: 'NWS',
  alerts: [],
  periods: [],
};

const STORMY: WeatherData = {
  ...QUIET,
  alerts: [{ event: 'Gale Warning', headline: 'Gale Warning in effect' }],
};

describe('AlertsPanel when the warning check failed', () => {
  it('never shows an all-clear for a check that got no answer', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);

    expect(screen.queryByText('Clear')).toBeNull();
    expect(screen.queryByText(/No active weather warnings or advisories/i)).toBeNull();
  });

  it('says the check failed, and that the absence is not an all-clear', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);

    expect(screen.getByText('Not checked')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Couldn't check for warnings — this is not an all-clear\. Warnings may be in force; the app will try again at the next refresh\./
      )
    ).toBeInTheDocument();
  });

  it('does not borrow the no-coverage copy, which would not be true here', () => {
    // NWS covers this position; the query simply failed. Saying no service
    // covers the water, or pointing at NAVTEX as the reason, would be a
    // different and false statement.
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);

    expect(screen.queryByText('No coverage')).toBeNull();
    expect(screen.queryByText(/No warning service covers this position/i)).toBeNull();
    expect(screen.queryByText(/NAVTEX or SafetyNET/i)).toBeNull();
  });

  it('still shows a warning that arrives, so a wrong flag under-claims rather than hides', () => {
    render(<AlertsPanel weatherData={STORMY} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);

    expect(screen.getByText('Gale Warning')).toBeInTheDocument();
    expect(screen.getByText(/1 active/)).toBeInTheDocument();
    expect(screen.queryByText('Not checked')).toBeNull();
  });

  it('outranks absent coverage when a host passes both flags false', () => {
    // Both are non-answers, so only one sentence can be shown. The failed check
    // is the specific thing that happened; the coverage copy would assert
    // something this panel does not know.
    render(
      <AlertsPanel
        weatherData={QUIET}
        lastSync={Date.now()}
        tempUnit="C"
        alertsChecked={false}
        hasWarningCoverage={false}
      />
    );

    expect(screen.getByText('Not checked')).toBeInTheDocument();
    expect(screen.queryByText('No coverage')).toBeNull();
  });

  it('leaves the no-coverage state alone when only that flag is false', () => {
    render(
      <AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked hasWarningCoverage={false} />
    );

    expect(screen.getByText('No coverage')).toBeInTheDocument();
    expect(screen.queryByText('Not checked')).toBeNull();
  });

  it('keeps the all-clear when the check did run and found nothing', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.getByText(/No active weather warnings or advisories/i)).toBeInTheDocument();
    expect(screen.queryByText('Not checked')).toBeNull();
  });

  it('defaults to checked, so a host that has not been updated is unchanged', () => {
    // The whole point of the default. HarborSentinel and OceanSentinel pass the
    // prop in follow-up PRs; until then their panels must render exactly as they
    // do today.
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.getByText(/No active weather warnings or advisories/i)).toBeInTheDocument();
    expect(screen.queryByText('Not checked')).toBeNull();
  });
});

/**
 * The full-screen bulletin, which carries the same claim in bigger type.
 *
 * It lives in this component rather than a separate one, so it takes the same
 * prop — but it has its own copy ("All Regional Hazards Clear"), so it needs its
 * own cases. It renders through a portal into `document.body` behind the
 * Bulletin button, and the collapsed card stays mounted underneath it, so the
 * shared sentence is asserted with `getAllByText`.
 */
describe('AlertsPanel bulletin when the warning check failed', () => {
  const openBulletin = () => fireEvent.click(screen.getByText('Bulletin'));

  it('never shows the full-screen all-clear for a check that got no answer', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);
    openBulletin();

    expect(screen.queryByText(/All Regional Hazards Clear/i)).toBeNull();
    expect(screen.queryByText(/No active small craft advisories/i)).toBeNull();
  });

  it("says the check failed, in the bulletin's own words and the shared sentence", () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);
    openBulletin();

    expect(screen.getByText('Warnings not checked')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /Couldn't check for warnings — this is not an all-clear\. Warnings may be in force; the app will try again at the next refresh\./
      ).length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Outside Warning Coverage/i)).toBeNull();
  });

  it('still lists a warning that arrives', () => {
    render(<AlertsPanel weatherData={STORMY} lastSync={Date.now()} tempUnit="C" alertsChecked={false} />);
    openBulletin();

    expect(screen.queryByText('Warnings not checked')).toBeNull();
    expect(screen.getByText(/Gale Warning in effect/)).toBeInTheDocument();
  });

  it('keeps the no-coverage bulletin when only that flag is false', () => {
    render(
      <AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked hasWarningCoverage={false} />
    );
    openBulletin();

    expect(screen.getByText(/Outside Warning Coverage/i)).toBeInTheDocument();
    expect(screen.queryByText('Warnings not checked')).toBeNull();
  });

  it('keeps the full-screen all-clear when the check did run and found nothing', () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" alertsChecked />);
    openBulletin();

    expect(screen.getByText(/All Regional Hazards Clear/i)).toBeInTheDocument();
    expect(screen.queryByText('Warnings not checked')).toBeNull();
  });

  it("defaults to checked, so an un-updated host's bulletin is unchanged", () => {
    render(<AlertsPanel weatherData={QUIET} lastSync={Date.now()} tempUnit="C" />);
    openBulletin();

    expect(screen.getByText(/All Regional Hazards Clear/i)).toBeInTheDocument();
    expect(screen.queryByText('Warnings not checked')).toBeNull();
  });
});
