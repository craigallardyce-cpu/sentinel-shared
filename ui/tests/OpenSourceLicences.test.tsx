import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { SettingsShell } from '../src/SettingsShell';
import { LICENCES_FILE } from '../src/OpenSourceLicences';

/*
  Terms of Service §5 says each app lists its open-source licences (Terms TF9).
  The list lives in About, which every app draws through SettingsShell, so this
  is the one place it needs to be.
*/
const FILE = {
  generatedAt: '2026-10-31T00:00:00.000Z',
  packages: [
    { name: 'react', version: '19.0.1', license: 'MIT', text: 0 },
    { name: 'leaflet', version: '1.9.4', license: 'BSD-2-Clause', text: 1 },
    { name: 'mystery', version: '0.0.1', license: 'UNKNOWN', text: -1 },
  ],
  texts: ['MIT License\n\nCopyright (c) Meta Platforms, Inc.', 'BSD 2-Clause License\n\nCopyright (c) Vladimir Agafonkin'],
};

function shell() {
  return render(<SettingsShell open onClose={() => {}} appName="TestApp" version="1.0.0" />);
}

afterEach(() => vi.unstubAllGlobals());

describe('Open-source licences in About', () => {
  it('lists every package and its licence text, from the file the build writes', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => FILE }));
    vi.stubGlobal('fetch', fetchMock);
    shell();
    expect(fetchMock).not.toHaveBeenCalled(); // nothing loads until asked
    fireEvent.click(screen.getByRole('button', { name: 'Open-source licences' }));
    expect(await screen.findByText(/TestApp is built with 3 open-source components/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(LICENCES_FILE);
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText(/Copyright \(c\) Vladimir Agafonkin/)).toBeInTheDocument();
    expect(screen.getByText(/No licence file is included with this package/)).toBeInTheDocument();
  });

  it('filters by name or licence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FILE })));
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'Open-source licences' }));
    await screen.findByText('react');
    fireEvent.change(screen.getByLabelText('Filter open-source licences'), { target: { value: 'bsd' } });
    expect(screen.queryByText('react')).toBeNull();
    expect(screen.getByText('leaflet')).toBeInTheDocument();
  });

  it('says so when the build carries no list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'Open-source licences' }));
    expect(await screen.findByText('The licence list is not included in this build.')).toBeInTheDocument();
  });
});
