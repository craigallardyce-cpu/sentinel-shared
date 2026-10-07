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
