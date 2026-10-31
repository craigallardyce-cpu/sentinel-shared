import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SettingsShell, SettingsSection, SettingsRow } from '../src/SettingsShell';

/**
 * The Settings header is the title and nothing else under it unless the app
 * supplies a `summary`.
 *
 * It used to explain the scope dot there ("Set on this device. Everything else
 * comes from your account, this boat or a default."), drawn when an app passed
 * `scopeLegend`. Craig removed it fleet-wide on 2026-10-07 as not needed; each
 * dot keeps its own tooltip. HarborSentinel and OceanSentinel still pass
 * `scopeLegend`, so the prop is accepted and must draw nothing.
 */

const LEGEND = /Everything else comes from your account/;

function shell(props: Partial<React.ComponentProps<typeof SettingsShell>> = {}) {
  return render(
    <SettingsShell open onClose={() => {}} appName="TestApp" version="1.0.0" {...props}>
      <SettingsSection title="Alarms">
        <SettingsRow label="Anchor alarm" source="device">
          <span>on</span>
        </SettingsRow>
      </SettingsSection>
    </SettingsShell>,
  );
}

describe('SettingsShell header', () => {
  it('draws no scope explanation when an app still passes scopeLegend', () => {
    shell({ scopeLegend: true });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.queryByText(LEGEND)).toBeNull();
    expect(screen.queryByText(/Set on this device\./)).toBeNull();
  });

  it('draws no scope explanation in the tabbed layout either', () => {
    shell({
      scopeLegend: true,
      tabs: [{ id: 'alarms', label: 'Alarms', content: <p>alarm settings</p> }],
    });
    expect(screen.queryByText(LEGEND)).toBeNull();
  });

  it('still draws an app-supplied summary under the title', () => {
    shell({ scopeLegend: true, summary: '3 values set on this device' });
    expect(screen.getByText('3 values set on this device')).toBeInTheDocument();
    expect(screen.queryByText(LEGEND)).toBeNull();
  });

  it('keeps the scope dot on the row itself', () => {
    const { baseElement } = shell();
    const dot = baseElement.querySelector('[data-source="device"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('title', 'Set on this device only, overriding anything broader.');
  });
});

/*
  The About line names the website. A Play build sells nothing in-app and may
  not link to where plans are sold, so there it is text, not a link.
*/
describe('SettingsShell About website link', () => {
  it('links to the website on a desktop', () => {
    shell();
    expect(screen.getByRole('link', { name: 'marinersentinel.com' })).toHaveAttribute('href', 'https://marinersentinel.com');
  });

  it('names the website without linking to it in a native build', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    try {
      shell();
      expect(screen.getByText('marinersentinel.com')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'marinersentinel.com' })).toBeNull();
    } finally {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    }
  });
});

describe('SettingsShell initialTab and initialFocus', () => {
  const TABS = [
    { id: 'vessel', label: 'Vessel', content: <SettingsRow label="Boat name"><input aria-label="Boat name" /></SettingsRow> },
    {
      id: 'alerts',
      label: 'Alerts & sync',
      content: <SettingsRow label="Alarm sound"><button type="button" id="alarm-sound">Sound on</button></SettingsRow>,
    },
  ];
  const tabbed = (props: Partial<React.ComponentProps<typeof SettingsShell>> = {}) => (
    <SettingsShell open onClose={() => {}} appName="TestApp" version="1.0.0" tabs={TABS} {...props} />
  );
  const selected = () => screen.getByRole('tab', { selected: true }).textContent;

  it('opens on the first tab without one', () => {
    render(tabbed());
    expect(selected()).toBe('Vessel');
  });

  it('opens on the tab it names, with that panel showing', () => {
    render(tabbed({ initialTab: 'alerts' }));
    expect(selected()).toBe('Alerts & sync');
    expect(screen.getByText('Sound on')).toBeVisible();
  });

  it('applies it again on the next open, and keeps the last tab when none is named', () => {
    const { rerender } = render(tabbed({ open: false }));
    rerender(tabbed({ open: true, initialTab: 'alerts' }));
    expect(selected()).toBe('Alerts & sync');
    rerender(tabbed({ open: false }));
    rerender(tabbed({ open: true }));
    expect(selected()).toBe('Alerts & sync');
  });

  it('focuses the control it names after the dialog has made its own first focus', async () => {
    render(tabbed({ initialTab: 'alerts', initialFocus: 'alarm-sound' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById('alarm-sound')).toHaveFocus();
  });
});

describe('SettingsRow under a wide control', () => {
  it('wraps, so a control that will not fit beside the label goes under it instead of squeezing it', () => {
    const { container } = render(
      <SettingsRow label="Row density" description="How tightly packed rows are.">
        <span>two buttons</span>
      </SettingsRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    const label = row.firstElementChild as HTMLElement;
    expect(label.className).toContain('basis-48');
    expect(label.className).toContain('flex-1');
  });
});
