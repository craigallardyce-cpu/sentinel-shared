import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AppShell, HeaderButton, HeaderGroup } from '../src/AppShell';
import type { ShellTab } from '../src/AppShell';
import { StatusPill } from '../src/StatusPill';
import { ScopeBadge } from '../src/ScopeBadge';
import { SettingsShell } from '../src/SettingsShell';

const TABS: ShellTab[] = [
  { id: 'maintenance', label: 'Maintenance', shortLabel: 'Maint', icon: <svg /> },
  { id: 'punch', label: 'Punch list', shortLabel: 'Punch', icon: <svg /> },
  { id: 'documents', label: 'Ships documents', shortLabel: 'Docs', icon: <svg /> },
];

function shell(props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return render(
    <AppShell appName="VesselKeeper" tabs={TABS} activeTab="maintenance" onTabChange={vi.fn()} {...props}>
      <p>content</p>
    </AppShell>
  );
}

/** The phone tab bar is the second "Primary" nav; the rail is the first. */
const phoneBar = () => screen.getAllByRole('navigation', { name: 'Primary' })[1];

describe('AppShell phone tab bar', () => {
  it('shows the full label, never shortLabel, and does not truncate it', () => {
    shell();
    const bar = phoneBar();
    for (const label of ['Maintenance', 'Punch list', 'Ships documents']) {
      const el = within(bar).getByText(label);
      expect(el.className).not.toContain('truncate');
    }
    for (const short of ['Maint', 'Punch', 'Docs']) {
      expect(within(bar).queryByText(short)).toBeNull();
    }
  });

  it('draws its labels at 13px by default', () => {
    shell();
    for (const button of within(phoneBar()).getAllByRole('button')) {
      expect(button.className).toContain('text-[13px]');
      expect(button.className).not.toContain('text-[12px]');
    }
  });

  it('draws them at 12px with tabLabelPx={12}', () => {
    shell({ tabLabelPx: 12 });
    for (const button of within(phoneBar()).getAllByRole('button')) {
      expect(button.className).toContain('text-[12px]');
      expect(button.className).not.toContain('text-[13px]');
    }
  });
});

describe('AppShell rail', () => {
  it('is 72px wide, with the icon over the full label', () => {
    const { container } = shell();
    const rail = container.querySelector('aside')!;
    expect(rail.className).toContain('w-18');
    const item = within(rail).getByRole('button', { name: 'Maintenance' });
    expect(item.className).toContain('flex-col');
    expect(item).toHaveAttribute('aria-current', 'page');
  });

  it('no longer renders the version footer, though the prop is still accepted', () => {
    shell({ dockFooter: <>VesselKeeper v2.13.0</> });
    expect(screen.queryByText(/v2\.13\.0/)).toBeNull();
  });
});

describe('AppShell surface', () => {
  const surfaceOf = (container: HTMLElement) => (container.firstElementChild as HTMLElement).dataset.surface;

  it('is a chart when a background is rendered, so chart screens need no change', () => {
    const { container } = shell({ tabs: [], activeTab: '', background: <div>chart</div>, bareMain: true, passThrough: true });
    expect(surfaceOf(container)).toBe('chart');
    expect(container.querySelector('header')!.className).toContain('glass-panel');
  });

  it('is a page otherwise: opaque header, no glass around the content', () => {
    const { container } = shell();
    expect(surfaceOf(container)).toBe('page');
    const header = container.querySelector('header')!;
    expect(header.className).not.toContain('glass-panel');
    expect(header.className).toContain('bg-bg-app');
    const main = container.querySelector('main')!;
    expect(main.className).not.toContain('glass-panel');
    expect(main.className).toContain('bg-bg-app');
  });

  it('takes the active tab surface over the shell one', () => {
    const tabs: ShellTab[] = [
      { id: 'map', label: 'Map', icon: <svg />, surface: 'chart' },
      { id: 'log', label: 'Log', icon: <svg /> },
    ];
    const { container, rerender } = render(<AppShell appName="OceanSentinel" tabs={tabs} activeTab="map" onTabChange={vi.fn()} surface="page" />);
    expect(surfaceOf(container)).toBe('chart');
    rerender(<AppShell appName="OceanSentinel" tabs={tabs} activeTab="log" onTabChange={vi.fn()} surface="page" />);
    expect(surfaceOf(container)).toBe('page');
  });
});

describe('HeaderButton', () => {
  it('is Inter 15/600 at 48px, with no mono or tracking', () => {
    render(<HeaderButton icon={<svg />} label="Night" aria-label="Night" />);
    const cls = screen.getByRole('button', { name: 'Night' }).className;
    expect(cls).toContain('h-12');
    expect(cls).toContain('text-[15px]');
    expect(cls).toContain('font-semibold');
    expect(cls).not.toMatch(/font-mono|tracking-|uppercase|drop-shadow/);
  });
});

describe('StatusPill', () => {
  it('is a dot and a word, with no box of its own', () => {
    const { container } = render(<StatusPill status="ok">Instruments</StatusPill>);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).not.toMatch(/(^|\s)(border|bg-)/);
    expect(screen.getByText('Instruments')).toBeInTheDocument();
  });

  it('pulses only for an alarm', () => {
    for (const status of ['ok', 'warning', 'offline', 'info'] as const) {
      const { container, unmount } = render(<StatusPill status={status} pulse>x</StatusPill>);
      expect(container.querySelector('.animate-ping'), status).toBeNull();
      unmount();
    }
    const { container } = render(<StatusPill status="alarm" pulse>Sync error</StatusPill>);
    expect(container.querySelector('.animate-ping')).not.toBeNull();
  });

  it('draws no box around a HeaderGroup either', () => {
    const { container } = render(<HeaderGroup><StatusPill status="ok">Cloud</StatusPill></HeaderGroup>);
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/(^|\s)(border|bg-|rounded|shadow)/);
  });
});

describe('ScopeBadge', () => {
  it('is a dot that still names its scope for a screen reader and a tooltip', () => {
    render(<ScopeBadge source="device" />);
    const dot = screen.getByRole('img', { name: 'This device' });
    expect(dot.textContent).toBe('');
    expect(dot.getAttribute('title')).toMatch(/^This device: /);
    expect(dot.className).toContain('rounded-full');
  });

  it('still hides for an untouched value', () => {
    const { container } = render(<ScopeBadge source="default" hideWhenUnset />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SettingsShell', () => {
  it('is titled "Settings" and puts Save and apply on the right as the primary action', () => {
    const onSave = vi.fn();
    render(
      <SettingsShell open onClose={vi.fn()} appName="HarborSentinel" onNightModeChange={vi.fn()} onSave={onSave} footer={<span>Unsaved</span>} />
    );
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save and apply' });
    expect(save.className).toContain('bg-cyan');
    // Last in the footer, so it sits at the right-hand end.
    expect(save.parentElement!.lastElementChild).toBe(save);
    save.click();
    expect(onSave).toHaveBeenCalled();
    // Night mode, when the shell draws it, is in Display.
    expect(screen.getByRole('switch', { name: 'Night mode' }).closest('section')!.textContent).toMatch(/^Display/);
  });

  it('draws its tabs with the shared Tabs strip and no icons', () => {
    render(
      <SettingsShell
        open
        onClose={vi.fn()}
        appName="OceanSentinel"
        onDayBrightnessChange={vi.fn()}
        tabs={[{ id: 'vessel', label: 'Vessel', icon: <svg data-testid="tab-icon" />, content: <p>vessel</p> }]}
      />
    );
    const names = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['Display', 'Vessel', 'About']);
    expect(screen.queryByTestId('tab-icon')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-controls', 'settings-panel-__display');
  });
});
