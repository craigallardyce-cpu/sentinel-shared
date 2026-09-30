import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import {
  WarningsBanner,
  BannerWarning,
  formatCheckAge,
  sentenceCase,
  sortWarnings,
  warningLevel,
} from '../src/WarningsBanner';
import * as pkg from '../src/index';

/**
 * The shared marine-warnings banner (fit-and-finish H4, O2, X4).
 *
 * The approved design turns on one rule: no warning in force renders nothing,
 * so the calm chart carries no bar restating SAFE. The non-answers (no
 * coverage, no position, a failed check) are not an all-clear and stay as a
 * quiet notice the host asks for explicitly; an empty list alone never
 * produces one.
 */

const SCA: BannerWarning = { event: 'Small Craft Advisory', severity: 'Minor', headline: 'SCA until 6 PM' };
const GALE: BannerWarning = { event: 'Gale Warning', severity: 'Moderate', headline: 'Gale Warning in effect' };
const STORM: BannerWarning = {
  event: 'Storm Warning',
  severity: 'Severe',
  headline: 'Storm Warning issued by NWS',
  effective: '2026-10-03T18:00:00Z',
  ends: '2026-10-04T06:00:00Z',
  instruction: 'Mariners should seek safe harbour.',
  senderName: 'NWS Melbourne FL',
};
const WATCH: BannerWarning = { event: 'Hurricane Watch', severity: 'Extreme' };

describe('WarningsBanner with nothing in force', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<WarningsBanner warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a missing list', () => {
    const { container } = render(<WarningsBanner warnings={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never says "No active warnings"', () => {
    render(<WarningsBanner warnings={[]} />);
    expect(screen.queryByText(/no active warnings/i)).toBeNull();
  });

  it('renders nothing for an explicit null notice', () => {
    const { container } = render(<WarningsBanner warnings={[]} notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('WarningsBanner notices (the non-answers)', () => {
  it.each([
    ['no-coverage', /no warning service covers this position/i],
    ['no-position', /no position, so no warnings checked/i],
    ['not-checked', /couldn't check for warnings/i],
  ] as const)('states %s quietly and never as an all-clear', (notice, text) => {
    const { container } = render(<WarningsBanner warnings={[]} notice={notice} />);
    const row = screen.getByText(text);
    expect(row).toHaveTextContent(/not an all-clear/i);
    const el = container.querySelector(`[data-notice="${notice}"]`)!;
    expect(el).toBeTruthy();
    // Quiet: the banner's glass, a neutral hairline, no status colour.
    expect(el.className).toContain('border-border-color');
    expect(el.className).toContain('bg-[var(--bg-panel-glass)]');
    expect(el.className).not.toMatch(/--color-(red|warning)|shadow/);
  });

  it('is replaced by the banner once a warning is in force', () => {
    render(<WarningsBanner warnings={[GALE]} notice="not-checked" />);
    expect(screen.queryByText(/couldn't check/i)).toBeNull();
    expect(screen.getByText('Gale warning')).toBeInTheDocument();
  });

  it('becomes a button when the host owns the detail view', () => {
    const onOpen = vi.fn();
    render(<WarningsBanner warnings={[]} notice="no-coverage" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('carries the chart-centre qualifier', () => {
    render(<WarningsBanner warnings={[]} notice="no-coverage" usingChartCentre />);
    expect(screen.getByText(/chart centre/i)).toBeInTheDocument();
  });
});

describe('severity', () => {
  it('reads a Warning, Severe, Extreme or ungraded alert as an alarm', () => {
    expect(warningLevel(STORM)).toBe('alarm');
    expect(warningLevel(GALE)).toBe('alarm'); // Moderate, but named a Warning
    expect(warningLevel(WATCH)).toBe('alarm');
    expect(warningLevel({ event: 'Special Marine Statement' })).toBe('alarm');
  });

  it('reads a Moderate or Minor advisory as a warning', () => {
    expect(warningLevel(SCA)).toBe('warning');
    expect(warningLevel({ event: 'Small Craft Advisory', severity: 'Moderate' })).toBe('warning');
  });

  it('lets the host override the level', () => {
    expect(warningLevel({ ...SCA, level: 'alarm' })).toBe('alarm');
  });

  it('orders most severe first and keeps the host order within a rank', () => {
    const second = { ...GALE, headline: 'second gale' };
    const order = sortWarnings([SCA, GALE, STORM, second, WATCH]);
    expect(order.map((w) => w.headline ?? w.event)).toEqual([
      'Hurricane Watch',
      'Storm Warning issued by NWS',
      'Gale Warning in effect',
      'second gale',
      'SCA until 6 PM',
    ]);
  });

  it('shows the most severe warning in the band, whatever order it arrived in', () => {
    render(<WarningsBanner warnings={[SCA, STORM]} />);
    const band = screen.getByRole('button');
    expect(band).toHaveTextContent(/^Storm warning/);
  });

  it("draws the board's glass band: 40% severity stroke, blur, no shadow, no dim fill", () => {
    const { rerender } = render(<WarningsBanner warnings={[STORM]} />);
    let section = screen.getByRole('alert');
    const cls = section.className;
    expect(cls).toContain('border-[color:color-mix(in_srgb,var(--color-red)_40%,transparent)]');
    expect(cls).toContain('bg-[var(--bg-panel-glass)]');
    expect(cls).toContain('[backdrop-filter:blur(16px)]');
    expect(cls).toContain('[-webkit-backdrop-filter:blur(16px)]');
    expect(cls).toContain('rounded-xl');
    expect(cls).not.toMatch(/shadow|glow|-dim/);
    expect(screen.getByRole('button').className).toMatch(/h-12/);

    rerender(<WarningsBanner warnings={[SCA]} />);
    section = screen.getByRole('status');
    expect(section.className).toContain('var(--color-warning)_40%');
  });
});

describe('count and expand', () => {
  it('shows no count for a single warning', () => {
    render(<WarningsBanner warnings={[STORM]} />);
    expect(screen.queryByTestId('warnings-banner-count')).toBeNull();
  });

  it('counts the rest when there is more than one', () => {
    render(<WarningsBanner warnings={[SCA, GALE, STORM]} />);
    expect(screen.getByTestId('warnings-banner-count')).toHaveTextContent('+2 more');
  });

  it('expands to list every warning, most severe first, and collapses again', () => {
    render(<WarningsBanner warnings={[SCA, STORM, GALE]} area="Cape Canaveral" />);
    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: /warnings in force/i });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.firstChild!.textContent)).toEqual([
      'Storm warning',
      'Gale warning',
      'Small craft advisory',
    ]);
    expect(screen.getByText('Cape Canaveral')).toBeInTheDocument();
    expect(screen.getByText('Mariners should seek safe harbour.')).toBeInTheDocument();
    expect(screen.getByText('Issued by NWS Melbourne FL')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('hands the click to the host instead when onOpen is given', () => {
    const onOpen = vi.fn();
    render(<WarningsBanner warnings={[STORM, GALE]} onOpen={onOpen} />);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveAttribute('aria-expanded');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('offers the full forecast from the expanded list', () => {
    const onOpenForecast = vi.fn();
    render(<WarningsBanner warnings={[STORM]} onOpenForecast={onOpenForecast} defaultExpanded />);
    fireEvent.click(screen.getByRole('button', { name: /open the full forecast/i }));
    expect(onOpenForecast).toHaveBeenCalledOnce();
  });
});

describe('host clauses', () => {
  it('reads the host detail after the event name', () => {
    render(<WarningsBanner warnings={[STORM]} detail="Hazardous conditions forecast from Saturday night" />);
    expect(screen.getByRole('button')).toHaveTextContent(
      'Storm warningHazardous conditions forecast from Saturday night'
    );
  });

  it('dates stale warnings rather than presenting them as current', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0);
    render(
      <WarningsBanner warnings={[STORM]} stale checkedAt={now - 12 * 60000} now={now} defaultExpanded />
    );
    expect(screen.getByRole('button')).toHaveTextContent('last checked 12 min ago');
    expect(screen.getByText(/these are from the last check/i)).toBeInTheDocument();
  });

  it('says a partial list may not be everything', () => {
    render(<WarningsBanner warnings={[GALE]} partial defaultExpanded />);
    expect(screen.getByText(/may not be all the warnings in force/i)).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('writes NWS event names in sentence case, keeping acronyms', () => {
    expect(sentenceCase('Gale Warning')).toBe('Gale warning');
    expect(sentenceCase('Hurricane Force Wind Warning')).toBe('Hurricane force wind warning');
    expect(sentenceCase('NWS Special Marine Statement')).toBe('NWS special marine statement');
  });

  it('formats a check age', () => {
    const now = 10_000_000_000;
    expect(formatCheckAge(null, now)).toBeNull();
    expect(formatCheckAge(now - 10_000, now)).toBe('just now');
    expect(formatCheckAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatCheckAge(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });

  it('is exported from the package index with its helpers', () => {
    expect(pkg.WarningsBanner).toBe(WarningsBanner);
    expect(pkg.sortWarnings).toBe(sortWarnings);
  });
});
