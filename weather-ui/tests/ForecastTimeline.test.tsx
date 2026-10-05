import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ForecastTimeline from '../src/ForecastTimeline';
import type { ForecastPeriod } from '../src/ForecastTimeline';

const PERIODS: ForecastPeriod[] = [
  {
    periodName: 'Today',
    windRange: '13 kts',
    windDirection: 'SW',
    tempRange: '67°F',
    precipChance: '3%',
    reason: 'PARTLY SUNNY, WITH A HIGH NEAR 67. SOUTHWEST WIND 6 TO 13 MPH.',
  },
  { periodName: 'Tonight', windRange: '12 kts', windDirection: 'NE', tempRange: '64°F', precipChance: '5%' },
];

/** Every class on every element, so a rule can be asserted over the whole tree. */
const allClasses = (root: HTMLElement) =>
  [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].map((el) => el.getAttribute('class') ?? '').join(' ');

describe('ForecastTimeline (bulletin)', () => {
  it('labels fields in sentence case, on one line, with the gust note under the value', () => {
    render(<ForecastTimeline periods={PERIODS} tempUnit="F" mode="bulletin" />);
    const labels = screen.getAllByText('Max wind');
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.className).toContain('text-label');
      expect(label.className).toContain('whitespace-nowrap');
      expect(label.className).not.toMatch(/uppercase|font-mono|tracking-/);
    }
    expect(screen.getAllByText('incl. gusts')).toHaveLength(2);
    expect(screen.queryByText(/Inc Gusts/i)).toBeNull();
  });

  it('draws values in mono 15/500 and period titles as written, not in capitals', () => {
    render(<ForecastTimeline periods={PERIODS} tempUnit="F" mode="bulletin" />);
    const value = screen.getByText('SW');
    expect(value.tagName).toBe('DD');
    expect(value.className).toContain('text-data-mono-lg');
    const title = screen.getByRole('heading', { name: 'Today' });
    expect(title.className).toContain('text-headline-md');
    expect(title.className).not.toContain('uppercase');
  });

  it('shows NWS prose in sentence case, Inter 15/400, with the original in its title', () => {
    render(<ForecastTimeline periods={PERIODS} tempUnit="F" mode="bulletin" />);
    const text = screen.getByText('Partly sunny, with a high near 67. Southwest wind 6 to 13 mph.');
    expect(text.className).toContain('text-body-md');
    expect(text.className).not.toMatch(/uppercase|font-mono/);
    expect(text).toHaveAttribute('title', PERIODS[0].reason);
  });

  it('is one full-width 16px surface per period, with no box inside it and no shadow', () => {
    const { container } = render(<ForecastTimeline periods={PERIODS} tempUnit="F" mode="bulletin" />);
    const cards = container.querySelectorAll<HTMLElement>('[data-slot="forecast-card"]');
    expect(cards).toHaveLength(2);
    for (const card of Array.from(cards)) {
      expect(card.className).toContain('w-full');
      expect(card.className).toContain('rounded-xl');
      expect(card.className).not.toMatch(/shadow/);
      for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        expect(el.getAttribute('class') ?? '').not.toMatch(/(?:^|\s)(?:border|bg-[a-z]|rounded)/);
      }
    }
  });
});

describe('ForecastTimeline (both modes)', () => {
  it('draws nothing under the 13px floor', () => {
    for (const mode of ['bulletin', 'sidebar'] as const) {
      const { container, unmount } = render(<ForecastTimeline periods={PERIODS} tempUnit="F" mode={mode} />);
      const cls = allClasses(container);
      expect(cls).not.toMatch(/(?:^|\s)text-xs(?:\s|$)/);
      for (const m of cls.matchAll(/text-\[(\d+)px\]/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(13);
      unmount();
    }
  });

  it('sidebar never truncates the period name and nothing pulses', () => {
    const { container } = render(<ForecastTimeline periods={PERIODS} tempUnit="F" />);
    expect(allClasses(container)).not.toMatch(/truncate|animate-pulse|uppercase/);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });
});

describe('ForecastTimeline: unit and names', () => {
  it('writes the wind in kt, as the fleet does, in both modes', () => {
    for (const mode of ['bulletin', 'sidebar'] as const) {
      const { container, unmount } = render(<ForecastTimeline periods={PERIODS} tempUnit="F" mode={mode} />);
      expect(container.textContent).toContain('13 kt');
      expect(container.textContent).not.toMatch(/\d kts\b/);
      unmount();
    }
  });

  it('restores the place names it is given in NWS capitals text', () => {
    const periods: ForecastPeriod[] = [
      { periodName: 'Today', windRange: '13 kts', reason: 'FOG NEAR NEWPORT. ISSUED BY NWS BOSTON.' },
    ];
    render(<ForecastTimeline periods={periods} tempUnit="F" mode="bulletin" placeNames={['Newport, RI']} />);
    expect(screen.getByText('Fog near Newport. Issued by NWS Boston.')).toBeInTheDocument();
  });
});
