import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWindField = vi.fn();
vi.mock('@sentinel/weather', () => ({
  fetchWindField: (...args: unknown[]) => fetchWindField(...args)
}));

import { useWindField } from '../src/useWindField';

/** A field that says which box it is for, so a test can tell two apart. */
const fieldFor = (bounds: { west: number; east: number; south: number; north: number }) => ({
  model: 'best_match',
  lats: [bounds.south, bounds.north],
  lons: [bounds.west, bounds.east],
  times: [0, 3_600_000],
  u: [[[1, 1], [1, 1]], [[1, 1], [1, 1]]],
  v: [[[0, 0], [0, 0]], [[0, 0], [0, 0]]],
  gust: [[[2, 2], [2, 2]], [[2, 2], [2, 2]]]
});

beforeEach(() => fetchWindField.mockReset());
afterEach(() => vi.useRealTimers());

describe('useWindField', () => {
  it('keeps the field on the chart when an hourly refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchWindField.mockImplementationOnce(async (bounds) => fieldFor(bounds));
    const { result } = renderHook(() => useWindField({ lat: 41.5, lon: -71.3, enabled: true }));
    await waitFor(() => expect(result.current.field).not.toBeNull());
    const first = result.current.field;

    // No cache was passed, as HarborSentinel passes none, and the refresh fails.
    fetchWindField.mockRejectedValueOnce(new Error('Failed to fetch'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    await waitFor(() => expect(fetchWindField).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.field).toBe(first);
    expect(result.current.error).toBeNull();
    expect(result.current.ageHours).toBeGreaterThanOrEqual(1);
  });

  it('reports the failure when there is nothing to keep', async () => {
    fetchWindField.mockRejectedValueOnce(new Error('Open-Meteo wind field returned HTTP 429'));
    const { result } = renderHook(() => useWindField({ lat: 41.5, lon: -71.3, enabled: true }));
    await waitFor(() => expect(result.current.errorKind).toBe('rate-limited'));
    expect(result.current.field).toBeNull();
  });

  it('does not keep a field for another box when the fetch for this one fails', async () => {
    fetchWindField.mockImplementationOnce(async (bounds) => fieldFor(bounds));
    const { result, rerender } = renderHook(
      ({ lon }) => useWindField({ lat: 41.5, lon, enabled: true }),
      { initialProps: { lon: -71.3 } }
    );
    await waitFor(() => expect(result.current.field).not.toBeNull());

    fetchWindField.mockRejectedValueOnce(new Error('Failed to fetch'));
    rerender({ lon: -40 });
    await waitFor(() => expect(result.current.errorKind).toBe('unavailable'));
    expect(result.current.field).toBeNull();
  });

  it('ignores an answer that arrives after a newer request has been made', async () => {
    let releaseOld: (value: unknown) => void = () => {};
    fetchWindField.mockImplementationOnce(
      (bounds) => new Promise((resolve) => { releaseOld = () => resolve(fieldFor(bounds)); })
    );
    fetchWindField.mockImplementationOnce(async (bounds) => fieldFor(bounds));

    const { result, rerender } = renderHook(
      ({ lon }) => useWindField({ lat: 41.5, lon, enabled: true }),
      { initialProps: { lon: -71.3 } }
    );
    // The boat's chart moves to another box before the first answer is back.
    rerender({ lon: -40 });
    await waitFor(() => expect(result.current.field?.lons).toEqual([-46, -34]));

    // The slow first answer lands now, and is for water the chart has left.
    await act(async () => {
      releaseOld(undefined);
      await Promise.resolve();
    });
    expect(result.current.field?.lons).toEqual([-46, -34]);
    expect(result.current.loading).toBe(false);
  });

  it('asks for wind on both sides of the 180th meridian', async () => {
    fetchWindField.mockImplementationOnce(async (asked) => fieldFor(asked));
    renderHook(() => useWindField({ lat: -17, lon: 179.5, enabled: true }));
    await waitFor(() => expect(fetchWindField).toHaveBeenCalled());
    const bounds = fetchWindField.mock.calls[0][0];
    expect(bounds.west).toBe(174);
    expect(bounds.east).toBe(186);
  });
});
