import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import {
  AdvisoryCollapseStore,
  AdvisoryCollapseSnapshot,
  BannerWarning,
  CollapseStorageLike,
  WarningsBanner,
  advisoryKey,
  hasNewAdvisory,
  isAdvisoryCollapsed,
  localStorageCollapseStore,
  parseAdvisoryCollapse,
} from '../src/WarningsBanner';
import * as pkg from '../src/index';

/**
 * Collapsing the banner to a pill (HarborSentinel #100, moved into the
 * package). The rule that matters: a collapse covers only the advisories in
 * force when it was made, so a new one always shows the banner expanded.
 */

const FROST: BannerWarning = { event: 'Frost Advisory', severity: 'Minor', effective: '2026-10-07T06:00:00Z' };
const FROST_AGAIN: BannerWarning = { ...FROST, effective: '2026-10-08T06:00:00Z' };
const SCA: BannerWarning = { event: 'Small Craft Advisory', severity: 'Minor', effective: '2026-10-07T09:00:00Z' };
const GALE: BannerWarning = { event: 'Gale Warning', severity: 'Moderate', effective: '2026-10-08T00:00:00Z' };

function memoryStore(initial: AdvisoryCollapseSnapshot | null = null) {
  const box = { value: initial, writes: 0 };
  const store: AdvisoryCollapseStore = {
    read: () => box.value,
    write: (s) => {
      box.value = s;
      box.writes += 1;
    },
  };
  return { box, store };
}

function memoryStorage(seed: Record<string, string> = {}): CollapseStorageLike & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const collapseButton = () => screen.getByRole('button', { name: 'Collapse the weather advisory' });
const queryCollapseButton = () => screen.queryByRole('button', { name: 'Collapse the weather advisory' });

describe('the advisory identity and the rule (pure)', () => {
  const frost = advisoryKey(FROST);
  const frostAgain = advisoryKey(FROST_AGAIN);
  const gale = advisoryKey(GALE);

  it('keys an advisory by event (case and space folded) and effective', () => {
    expect(advisoryKey({ event: ' Frost Advisory ', effective: 'T' })).toBe(advisoryKey({ event: 'frost advisory', effective: 'T' }));
    expect(advisoryKey({ event: 'Frost Advisory' })).toBe('frost advisory|');
    expect(frost).not.toBe(frostAgain);
  });

  it('stays collapsed only while everything in force was collapsed', () => {
    expect(isAdvisoryCollapsed([frost], [frost])).toBe(true);
    expect(isAdvisoryCollapsed([frost, gale], [gale])).toBe(true);
    expect(isAdvisoryCollapsed([frost], [frost, gale])).toBe(false);
    expect(isAdvisoryCollapsed([frost], [frostAgain])).toBe(false);
    expect(hasNewAdvisory([frost], [frost, gale])).toBe(true);
    expect(hasNewAdvisory([frost], [frost])).toBe(false);
  });

  it('is never collapsed with nothing collapsed or nothing in force', () => {
    expect(isAdvisoryCollapsed(null, [frost])).toBe(false);
    expect(isAdvisoryCollapsed([], [frost])).toBe(false);
    expect(isAdvisoryCollapsed([frost], [])).toBe(false);
    expect(hasNewAdvisory([frost], [])).toBe(false);
  });

  it('drops junk when parsing a stored snapshot', () => {
    expect(parseAdvisoryCollapse(null)).toBeNull();
    expect(parseAdvisoryCollapse('')).toBeNull();
    expect(parseAdvisoryCollapse('{not json')).toBeNull();
    expect(parseAdvisoryCollapse('{"a":1}')).toBeNull();
    expect(parseAdvisoryCollapse('[]')).toBeNull();
    expect(parseAdvisoryCollapse('[1, null]')).toBeNull();
    expect(parseAdvisoryCollapse('["a|", 3]')).toEqual(['a|']);
  });
});

describe('collapsing and restoring', () => {
  it('collapses to a pill that names the advisory, and restores it', () => {
    const { box, store } = memoryStore();
    render(<WarningsBanner warnings={[FROST]} collapseStore={store} />);

    const btn = collapseButton();
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(btn.className).toMatch(/\bw-11\b/);
    expect(btn.className).toMatch(/\bh-12\b/);
    fireEvent.click(btn);

    const pill = screen.getByRole('button', { name: 'Show the weather advisory: Frost advisory' });
    expect(pill).toHaveTextContent('Frost advisory');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(pill.className).toMatch(/\bmin-h-11\b/);
    expect(pill.className).toContain('text-warning');
    expect(pill.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull(); // the banner itself is gone, the pill is not
    expect(box.value).toEqual([advisoryKey(FROST)]);

    fireEvent.click(pill);
    expect(collapseButton()).toBeInTheDocument();
    expect(screen.getByText('Frost advisory')).toBeInTheDocument();
    expect(box.value).toBeNull();
  });

  it('names the top warning and counts the rest on the pill', () => {
    const { store } = memoryStore([advisoryKey(SCA), advisoryKey(GALE)]);
    render(<WarningsBanner warnings={[SCA, GALE]} collapseStore={store} />);
    const pill = screen.getByTestId('advisory-pill');
    expect(pill).toHaveAccessibleName('Show the weather advisory: Gale warning and 1 more');
    expect(pill).toHaveTextContent('+1');
    expect(pill).toHaveAttribute('data-level', 'alarm');
  });

  it('works without a store, for the session', () => {
    render(<WarningsBanner warnings={[FROST]} collapsible />);
    fireEvent.click(collapseButton());
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();
  });

  it('works beside a host-owned detail view (onOpen)', () => {
    render(<WarningsBanner warnings={[FROST]} collapsible onOpen={() => {}} />);
    fireEvent.click(collapseButton());
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();
  });

  it('puts the host className on the wrapper', () => {
    const { container, rerender } = render(<WarningsBanner warnings={[FROST]} collapsible className="host-place" />);
    expect(container.firstElementChild).toHaveClass('host-place');
    expect(container.querySelector('section[aria-label="Marine warnings"]')).not.toHaveClass('host-place');
    fireEvent.click(collapseButton());
    rerender(<WarningsBanner warnings={[FROST]} collapsible className="host-place" />);
    expect(container.firstElementChild).toHaveClass('host-place');
  });

  it('offers no collapse for the quiet notices, which render as before', () => {
    const { container } = render(<WarningsBanner warnings={[]} notice="not-checked" collapsible />);
    expect(queryCollapseButton()).toBeNull();
    expect(container.querySelector('[data-notice="not-checked"]')).not.toBeNull();
  });

  it('renders nothing with nothing in force', () => {
    const { container } = render(<WarningsBanner warnings={[]} collapsible />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a new advisory shows the banner expanded', () => {
  it('comes back collapsed while the same advisory is in force', () => {
    const { store } = memoryStore([advisoryKey(FROST)]);
    render(<WarningsBanner warnings={[FROST]} collapseStore={store} />);
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();
  });

  it('expands for a different event and forgets the collapse', () => {
    const { box, store } = memoryStore();
    const { rerender } = render(<WarningsBanner warnings={[FROST]} collapseStore={store} />);
    fireEvent.click(collapseButton());
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();

    act(() => rerender(<WarningsBanner warnings={[FROST, SCA]} collapseStore={store} />));
    expect(screen.queryByTestId('advisory-pill')).toBeNull();
    expect(collapseButton()).toBeInTheDocument();
    expect(box.value).toBeNull();

    // Spent: when the new one goes, the old one does not fold away again by itself.
    act(() => rerender(<WarningsBanner warnings={[FROST]} collapseStore={store} />));
    expect(screen.queryByTestId('advisory-pill')).toBeNull();
  });

  it('expands for the same event re-issued with a new effective time', () => {
    const { box, store } = memoryStore([advisoryKey(FROST)]);
    render(<WarningsBanner warnings={[FROST_AGAIN]} collapseStore={store} />);
    expect(screen.queryByTestId('advisory-pill')).toBeNull();
    expect(collapseButton()).toBeInTheDocument();
    expect(box.value).toBeNull();
  });

  it('stays collapsed when one of the collapsed advisories ends', () => {
    const { store } = memoryStore([advisoryKey(FROST), advisoryKey(SCA)]);
    render(<WarningsBanner warnings={[SCA]} collapseStore={store} />);
    expect(screen.getByTestId('advisory-pill')).toHaveTextContent('Small craft advisory');
  });
});

describe('persistence through the adapter', () => {
  it('localStorageCollapseStore round-trips a snapshot as a JSON array', () => {
    const storage = memoryStorage();
    const store = localStorageCollapseStore('k', storage);
    expect(store.read()).toBeNull();
    store.write(['frost advisory|T']);
    expect(storage.data.k).toBe('["frost advisory|T"]');
    expect(store.read()).toEqual(['frost advisory|T']);
    store.write(null);
    expect('k' in storage.data).toBe(false);
    store.write([]);
    expect('k' in storage.data).toBe(false);
  });

  it('reads the format HarborSentinel already stored', () => {
    const key = advisoryKey(FROST);
    const storage = memoryStorage({ harbor_advisory_collapsed: JSON.stringify([key]) });
    render(<WarningsBanner warnings={[FROST]} collapseStore={localStorageCollapseStore('harbor_advisory_collapsed', storage)} />);
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();
  });

  it('defaults to window.localStorage', () => {
    window.localStorage.removeItem('wb_test');
    const store = localStorageCollapseStore('wb_test');
    store.write(['x|']);
    expect(window.localStorage.getItem('wb_test')).toBe('["x|"]');
    expect(store.read()).toEqual(['x|']);
    store.write(null);
    expect(window.localStorage.getItem('wb_test')).toBeNull();
  });

  it.each(['{not json', '"frost"', '{"a":1}', '[1,2]', ''])('treats junk %j as not collapsed', (raw) => {
    const storage = memoryStorage({ k: raw });
    render(<WarningsBanner warnings={[FROST]} collapseStore={localStorageCollapseStore('k', storage)} />);
    expect(collapseButton()).toBeInTheDocument();
  });

  it('survives storage that throws on every access', () => {
    const boom = () => {
      throw new Error('denied');
    };
    const storage: CollapseStorageLike = { getItem: boom, setItem: boom, removeItem: boom };
    const store = localStorageCollapseStore('k', storage);
    expect(store.read()).toBeNull();
    expect(() => store.write(['x|'])).not.toThrow();

    render(<WarningsBanner warnings={[FROST]} collapseStore={store} />);
    fireEvent.click(collapseButton());
    // Remembered for the session even though nothing could be written.
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('advisory-pill'));
    expect(collapseButton()).toBeInTheDocument();
  });

  it('survives a host store that throws or returns junk', () => {
    const throwing: AdvisoryCollapseStore = {
      read: () => {
        throw new Error('nope');
      },
      write: () => {
        throw new Error('nope');
      },
    };
    const { unmount } = render(<WarningsBanner warnings={[FROST]} collapseStore={throwing} />);
    fireEvent.click(collapseButton());
    expect(screen.getByTestId('advisory-pill')).toBeInTheDocument();
    unmount();

    const junk = { read: () => 'frost' as unknown as string[], write: () => {} };
    render(<WarningsBanner warnings={[FROST]} collapseStore={junk} />);
    expect(collapseButton()).toBeInTheDocument();
  });
});

describe('without the new props', () => {
  it('is the banner exactly as before: no collapse control, host class on the section', () => {
    const { container } = render(<WarningsBanner warnings={[FROST]} className="host-place" />);
    expect(queryCollapseButton()).toBeNull();
    expect(screen.queryByTestId('advisory-pill')).toBeNull();
    const section = container.firstElementChild!;
    expect(section.tagName).toBe('SECTION');
    expect(section).toHaveClass('host-place');
  });

  it('ignores a stored collapse it was not given', () => {
    window.localStorage.setItem('harbor_advisory_collapsed', JSON.stringify([advisoryKey(FROST)]));
    render(<WarningsBanner warnings={[FROST]} />);
    expect(screen.queryByTestId('advisory-pill')).toBeNull();
    window.localStorage.removeItem('harbor_advisory_collapsed');
  });

  it('exports the collapse API from the package entry', () => {
    expect(pkg.localStorageCollapseStore).toBe(localStorageCollapseStore);
    expect(pkg.advisoryKey).toBe(advisoryKey);
    expect(pkg.isAdvisoryCollapsed).toBe(isAdvisoryCollapsed);
    expect(pkg.hasNewAdvisory).toBe(hasNewAdvisory);
    expect(pkg.parseAdvisoryCollapse).toBe(parseAdvisoryCollapse);
  });
});
