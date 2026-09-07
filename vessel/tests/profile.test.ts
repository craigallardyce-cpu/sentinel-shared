import { describe, expect, it } from 'vitest';
import { fetchVesselProfile, resolveOwnVessel, saveVesselProfile } from '../src/index.js';

/**
 * Which boat these helpers act on.
 *
 * Until migration 053 the answer was the literal `'sentinel'`, inherited by
 * every call site in the fleet through a default parameter. One row, one
 * customer. These tests pin the replacement: with no target the query carries
 * no `vessel_slug` filter at all and RLS decides, which is what "my vessel"
 * has to mean once there are two.
 */

interface Call { table: string; op: string; filters: Array<[string, unknown]>; ordered: boolean; values?: unknown }

/** Records what reached the client, and answers with `rows`. */
function fakeClient(rows: Array<Record<string, unknown>>, calls: Call[] = [], error: unknown = null) {
  return {
    calls,
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [], ordered: false };
      calls.push(call);
      const chain: any = {
        select() { return chain; },
        update(values: unknown) { call.op = 'update'; call.values = values; return chain; },
        eq(col: string, val: unknown) { call.filters.push([col, val]); return chain; },
        order() { call.ordered = true; return chain; },
        limit() { return Promise.resolve({ data: rows, error }); },
        then(res: any) { return Promise.resolve({ data: rows, error }).then(res); },
      };
      return chain;
    },
  };
}

const ROW = { id: 'a1b2', vessel_slug: 'saorsa-ii', name: 'Saorsa II', vessel_type: 'Ketch', mmsi: '232003456' };

describe('fetchVesselProfile', () => {
  it('asks for no particular slug when given no target, and lets RLS answer', async () => {
    const calls: Call[] = [];
    const profile = await fetchVesselProfile(fakeClient([ROW], calls) as any);

    expect(calls[0].filters).toEqual([]);           // the whole point: no 'sentinel'
    expect(calls[0].ordered).toBe(true);            // stable pick if an account has two
    expect(profile?.id).toBe('a1b2');
    expect(profile?.vesselSlug).toBe('saorsa-ii');
  });

  it('still accepts a bare slug, so anything that passed one keeps working', async () => {
    const calls: Call[] = [];
    await fetchVesselProfile(fakeClient([ROW], calls) as any, 'saorsa-ii');
    expect(calls[0].filters).toEqual([['vessel_slug', 'saorsa-ii']]);
  });

  it('addresses a vessel by id when given one', async () => {
    const calls: Call[] = [];
    await fetchVesselProfile(fakeClient([ROW], calls) as any, { id: 'a1b2' });
    expect(calls[0].filters).toEqual([['id', 'a1b2']]);
  });

  it('is null rather than throwing when the read fails', async () => {
    expect(await fetchVesselProfile(fakeClient([], [], { message: 'offline' }) as any)).toBeNull();
  });

  it('is null when the account has no vessel yet', async () => {
    expect(await fetchVesselProfile(fakeClient([]) as any)).toBeNull();
  });

  it('survives a second row rather than refusing, taking the oldest', async () => {
    const second = { ...ROW, id: 'c3d4', vessel_slug: 'other' };
    const profile = await fetchVesselProfile(fakeClient([ROW, second]) as any);
    expect(profile?.id).toBe('a1b2');
  });
});

describe('resolveOwnVessel', () => {
  it('hands back both handles, because merge_vessel_settings still takes a slug', async () => {
    expect(await resolveOwnVessel(fakeClient([ROW]) as any)).toEqual({ id: 'a1b2', vesselSlug: 'saorsa-ii' });
  });

  it('is null when nothing resolves, so a caller cannot write to a guess', async () => {
    expect(await resolveOwnVessel(fakeClient([]) as any)).toBeNull();
  });
});

describe('saveVesselProfile', () => {
  it('resolves an id first, then names that row in the update', async () => {
    const calls: Call[] = [];
    const ok = await saveVesselProfile(fakeClient([ROW], calls) as any, { mmsi: '111' });

    expect(ok).toBe(true);
    expect(calls[0].op).toBe('select');                       // read to resolve
    expect(calls[1].op).toBe('update');
    expect(calls[1].filters).toEqual([['id', 'a1b2']]);       // never an unfiltered UPDATE
  });

  it('refuses rather than writing unfiltered when no vessel resolves', async () => {
    const calls: Call[] = [];
    expect(await saveVesselProfile(fakeClient([], calls) as any, { mmsi: '111' })).toBe(false);
    expect(calls.every(c => c.op === 'select')).toBe(true);
  });

  it('writes nothing, and says so, for an empty patch', async () => {
    const calls: Call[] = [];
    expect(await saveVesselProfile(fakeClient([ROW], calls) as any, {})).toBe(true);
    expect(calls).toEqual([]);
  });

  it('skips the resolving read when the caller named the vessel', async () => {
    const calls: Call[] = [];
    await saveVesselProfile(fakeClient([ROW], calls) as any, { name: 'Kittiwake' }, { id: 'zz99' });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('update');
    expect(calls[0].filters).toEqual([['id', 'zz99']]);
  });
});
