import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppShell, HeaderGroup } from '../src/AppShell';
import { StatusPill } from '../src/StatusPill';
import { PlanPill } from '../src/PlanPill';

/**
 * The header's status band is meant to be the one that gives way, and for a
 * while it could not: `HeaderGroup` was `shrink-0`, so the band never got
 * narrower than the pills inside it and its `overflow-hidden` cut a label off
 * mid-word instead — a pill reading "Connecte" with a border through it on a
 * 412px phone.
 *
 * jsdom does no layout, so nothing here can measure that. What it can pin is
 * the property that produces it: an unbroken chain, from a pill's label up to
 * the header, of boxes that are allowed to narrow, each with a floor of its
 * own so the shrinking stops at a dot rather than at nothing. Break any link
 * and the guillotine is back. The layout itself was measured in Chromium at
 * 320/360/412/640/768/1024/1280px; the numbers are in the pull request.
 */

afterEach(cleanup);

const LONG_LABEL = 'Connected — anchor watch gateway 10.0.0.14';

/** Boxes from `from` up to and including `to`. */
function chainUpTo(from: HTMLElement, to: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let el: HTMLElement | null = from; el; el = el.parentElement) {
    chain.push(el);
    if (el === to) return chain;
  }
  throw new Error('never reached the container');
}

const classes = (el: HTMLElement) => el.className.split(/\s+/);

/**
 * A flex item will not go below its min-content size unless something says
 * otherwise, and a pill's min-content is its whole label because the label does
 * not wrap. An explicit `min-w-*` overrides that; so does clipping its own
 * overflow, which `truncate` does.
 */
const mayNarrow = (el: HTMLElement) =>
  classes(el).some((c) => /^min-w-(0|8|9)$/.test(c) || c === 'truncate' || c === 'overflow-hidden');

const isPinned = (el: HTMLElement) => classes(el).includes('shrink-0');

function headerOf(container: HTMLElement): HTMLElement {
  const header = container.querySelector('header');
  if (!header) throw new Error('no header');
  return header as HTMLElement;
}

function renderShell(headerStatus: React.ReactNode) {
  return render(
    <AppShell
      appName="HarborSentinel"
      tabs={[]}
      activeTab=""
      onTabChange={vi.fn()}
      onToggleNightMode={vi.fn()}
      onOpenSettings={vi.fn()}
      headerStatus={headerStatus}
    />
  );
}

describe('the header status band under a squeeze', () => {
  it('leaves a long pill label a shrink chain all the way up to the header, so the group cannot hold the band open', () => {
    const { container } = renderShell(
      <HeaderGroup>
        <StatusPill status="ok">{LONG_LABEL}</StatusPill>
      </HeaderGroup>
    );

    const label = screen.getByText(LONG_LABEL);
    const chain = chainUpTo(label, headerOf(container));

    // The header itself is the container being fitted into, not a link.
    const links = chain.slice(0, -1);
    expect(links.length).toBeGreaterThan(2);
    for (const el of links) {
      expect(mayNarrow(el), `nothing lets this box narrow: "${el.className}"`).toBe(true);
      expect(isPinned(el), `shrink-0 blocks the squeeze here: "${el.className}"`).toBe(false);
    }
  });

  it('leaves PlanPill the same chain, since the band now carries two pills', () => {
    const { container } = renderShell(
      <HeaderGroup>
        <StatusPill status="ok">Connected</StatusPill>
        <PlanPill planLabel="HarborSentinel Premium" onManage={vi.fn()} />
      </HeaderGroup>
    );

    const label = screen.getByText('HarborSentinel Premium');
    for (const el of chainUpTo(label, headerOf(container)).slice(0, -1)) {
      expect(mayNarrow(el), `nothing lets this box narrow: "${el.className}"`).toBe(true);
      expect(isPinned(el), `shrink-0 blocks the squeeze here: "${el.className}"`).toBe(false);
    }
  });

  it('does not pin HeaderGroup, which is the defect this fixes', () => {
    const { container } = render(
      <HeaderGroup>
        <StatusPill status="ok">Connected</StatusPill>
      </HeaderGroup>
    );
    const group = container.firstElementChild as HTMLElement;
    expect(classes(group)).not.toContain('shrink-0');
    expect(classes(group)).toContain('min-w-0');
  });

  it('keeps a caller class on HeaderGroup without losing the ability to shrink', () => {
    const { container } = render(<HeaderGroup className="gap-1"><StatusPill status="ok">Connected</StatusPill></HeaderGroup>);
    const group = container.firstElementChild as HTMLElement;
    expect(classes(group)).toContain('gap-1');
    expect(classes(group)).toContain('min-w-0');
  });
});

describe('StatusPill giving ground', () => {
  it('truncates its label rather than letting it run past the pill', () => {
    render(<StatusPill status="ok">{LONG_LABEL}</StatusPill>);
    expect(classes(screen.getByText(LONG_LABEL))).toContain('truncate');
  });

  it('floors at its own chrome, so a squeezed pill keeps its dot inside its border', () => {
    const { container: sm } = render(<StatusPill status="ok">Connected</StatusPill>);
    // 8px dot + 6px gap + 2 × 8px padding + 2px border = 32px = min-w-8.
    expect(classes(sm.firstElementChild as HTMLElement)).toContain('min-w-8');
    cleanup();

    const { container: md } = render(<StatusPill status="ok" size="md">Connected</StatusPill>);
    // The md pill's padding is 10px a side, so its floor is a step wider.
    expect(classes(md.firstElementChild as HTMLElement)).toContain('min-w-9');
  });

  it('renders no label box when there is no label, so the dot keeps the pill to itself', () => {
    const { container } = render(<StatusPill status="ok" />);
    const pill = container.firstElementChild as HTMLElement;
    // Just the dot: a second, empty child would still take the flex gap.
    expect(pill.children).toHaveLength(1);
    expect(pill.querySelector('.truncate')).toBeNull();
  });

  it('is unchanged in compact form, which has no label to truncate', () => {
    const { container } = render(<StatusPill status="ok" compact title="Connected" />);
    expect(container.querySelector('.truncate')).toBeNull();
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument();
  });
});

describe('what must survive the squeeze', () => {
  it('keeps Night and Settings pinned and reachable, whatever the status band does', () => {
    const { container } = renderShell(
      <HeaderGroup>
        <StatusPill status="ok">{LONG_LABEL}</StatusPill>
      </HeaderGroup>
    );

    for (const name of ['Switch to night mode', 'Settings']) {
      const control = screen.getByRole('button', { name });
      expect(control).toBeInTheDocument();
      const band = control.parentElement as HTMLElement;
      expect(classes(band), `${name} sits in a band that can be squeezed away`).toContain('shrink-0');
    }

    // And the brand keeps its own band, as the three-band comment requires.
    const brand = headerOf(container).firstElementChild as HTMLElement;
    expect(classes(brand)).toContain('shrink-0');
  });

  it('lets the plan give way before the status does', () => {
    const { container } = render(<PlanPill planLabel="HarborSentinel Premium" onManage={vi.fn()} />);
    const plan = container.firstElementChild as HTMLElement;
    // Weighted above the default 1 that StatusPill keeps: a plan is not a
    // health state, and its name is in the accessible name either way.
    expect(classes(plan)).toContain('shrink-[3]');
    expect(classes(plan)).toContain('min-w-8');

    cleanup();
    const { container: status } = render(<StatusPill status="ok">Connected</StatusPill>);
    expect((status.firstElementChild as HTMLElement).className).not.toMatch(/(^|\s)shrink-/);
  });

  it('keeps the plan pill tap target from closing below the pill it wraps', () => {
    render(<PlanPill planLabel="HarborSentinel Premium" onManage={vi.fn()} />);
    expect(classes(screen.getByRole('button', { name: /Manage or cancel/ }))).toContain('min-w-8');
  });
});
