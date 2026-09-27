import { describe, expect, it } from 'vitest';
import {
  BEAM_M_RANGE,
  HULL_FORMS,
  LOA_M_RANGE,
  fetchVesselProfile,
  resolveOwnVessel,
  saveVesselProfile,
  validateVesselProfilePatch,
} from '../src/index.js';

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

/*
  The hull geometry, as PostgREST hands it over: `numeric` arrives as a string,
  which is why the readers parse rather than cast.
*/
const MEASURED = { ...ROW, hull_form: 'catamaran', loa_m: '12.8', beam_m: '7.2' };

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

/**
 * The hull geometry (website migration 066), which the VesselKeeper safety
 * equipment location chart draws its outline from.
 *
 * Three of these tests are about absence rather than presence, and that is the
 * point: no vessel already in the database has any of these columns filled, a
 * chart shown for a boat of unknown size would be a lie, and a row written by a
 * later release that knows a fourth hull form still has to be readable here.
 */
describe('hull geometry', () => {
  it('round-trips through a read and a write, in metres', async () => {
    const profile = await fetchVesselProfile(fakeClient([MEASURED]) as any);
    expect(profile?.hullForm).toBe('catamaran');
    expect(profile?.loaM).toBe(12.8);
    expect(profile?.beamM).toBe(7.2);

    const calls: Call[] = [];
    const ok = await saveVesselProfile(
      fakeClient([MEASURED], calls) as any,
      { hullForm: 'trimaran', loaM: 12.8, beamM: 7.2 },
      { id: 'a1b2' }
    );

    expect(ok).toBe(true);
    expect(calls[0].values).toMatchObject({ hull_form: 'trimaran', loa_m: 12.8, beam_m: 7.2 });
  });

  it('asks for the three columns, so a fresh checkout cannot read a profile without them', async () => {
    let requested = '';
    const client = { from: () => ({ select(cols: string) { requested = cols; return this; }, order() { return this; }, limit: () => Promise.resolve({ data: [MEASURED], error: null }) }) };
    await fetchVesselProfile(client as any);
    for (const column of ['hull_form', 'loa_m', 'beam_m']) expect(requested).toContain(column);
  });

  it('reads an unknown hull form as null rather than throwing', async () => {
    // A row written by a later release that adds a fourth form. The app on the
    // boat may be a season behind it.
    const profile = await fetchVesselProfile(fakeClient([{ ...MEASURED, hull_form: 'proa' }]) as any);
    expect(profile?.hullForm).toBeNull();
    expect(profile?.loaM).toBe(12.8);   // the rest of the row still reads
  });

  it('reads an unmeasured boat as null on all three, not as zero', async () => {
    const profile = await fetchVesselProfile(fakeClient([ROW]) as any);
    expect(profile?.hullForm).toBeNull();
    expect(profile?.loaM).toBeNull();
    expect(profile?.beamM).toBeNull();
  });

  it('reads a dimension that is not a number as absent, never as NaN', async () => {
    // NaN would be drawn, silently, as a boat of no size.
    const profile = await fetchVesselProfile(fakeClient([{ ...MEASURED, loa_m: '', beam_m: 'twelve' }]) as any);
    expect(profile?.loaM).toBeNull();
    expect(profile?.beamM).toBeNull();
  });

  it('offers exactly the three forms the database CHECK accepts', () => {
    expect(HULL_FORMS.map((option) => option.value)).toEqual(['monohull', 'catamaran', 'trimaran']);
    expect(HULL_FORMS.map((option) => option.label)).toEqual(['Monohull', 'Catamaran', 'Trimaran']);
  });
});

describe('validating the hull geometry before it is sent', () => {
  /*
    Out of range is loud, and the reason is that `false` already means something
    else. A caller cannot tell a refused CHECK from bad signal, and the two need
    opposite reactions: retry the one, correct the other.
  */
  it.each([
    ['a length at the bottom of the range', { loaM: 0 }],
    ['a negative length', { loaM: -1 }],
    ['a length at the top of the range', { loaM: LOA_M_RANGE.exclusiveMax }],
    ['a length past it', { loaM: 250 }],
    ['a beam at the bottom of the range', { beamM: 0 }],
    ['a beam at the top of the range', { beamM: BEAM_M_RANGE.exclusiveMax }],
    ['a beam in feet by mistake', { beamM: 120 }],
    ['a length that is not a number', { loaM: Number.NaN }],
  ])('rejects %s without sending anything', async (_label, patch) => {
    const calls: Call[] = [];
    await expect(
      saveVesselProfile(fakeClient([MEASURED], calls) as any, patch as any, { id: 'a1b2' })
    ).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);          // nothing reached the database
    expect(validateVesselProfilePatch(patch as any)).not.toBeNull();
  });

  it('rejects a hull form the CHECK would refuse, for a caller without types', async () => {
    const calls: Call[] = [];
    await expect(
      saveVesselProfile(fakeClient([MEASURED], calls) as any, { hullForm: 'proa' } as any, { id: 'a1b2' })
    ).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it('accepts the values just inside the range, and a patch that clears them', () => {
    expect(validateVesselProfilePatch({ loaM: 0.5, beamM: 0.5 })).toBeNull();
    expect(validateVesselProfilePatch({ loaM: 199.9, beamM: 99.9 })).toBeNull();
    expect(validateVesselProfilePatch({ hullForm: null, loaM: null, beamM: null })).toBeNull();
    expect(validateVesselProfilePatch({})).toBeNull();
  });
});

describe('a patch says what to write, and nothing else', () => {
  it('leaves a field the patch does not carry untouched', async () => {
    const calls: Call[] = [];
    await saveVesselProfile(fakeClient([MEASURED], calls) as any, { loaM: 13.1 }, { id: 'a1b2' });

    const values = calls[0].values as Record<string, unknown>;
    expect(values.loa_m).toBe(13.1);
    expect(values).not.toHaveProperty('hull_form');
    expect(values).not.toHaveProperty('beam_m');
    expect(values).not.toHaveProperty('name');
    expect(Object.keys(values).sort()).toEqual(['loa_m', 'updated_at']);
  });

  it('clears a column when the patch carries an explicit null', async () => {
    const calls: Call[] = [];
    await saveVesselProfile(
      fakeClient([MEASURED], calls) as any,
      { hullForm: null, loaM: null, beamM: null },
      { id: 'a1b2' }
    );

    expect(calls[0].values).toMatchObject({ hull_form: null, loa_m: null, beam_m: null });
  });

  it('still writes nothing at all for an empty patch', async () => {
    const calls: Call[] = [];
    expect(await saveVesselProfile(fakeClient([MEASURED], calls) as any, {})).toBe(true);
    expect(calls).toEqual([]);
  });
});
