import { describe, expect, it } from 'vitest';
import { createRegistry, defaultFor, defineSetting } from '../src/registry.js';
import { boolType, hostType, intType, portType, stringType } from '../src/valueTypes.js';

describe('createRegistry', () => {
  it('attaches the map key to each definition', () => {
    const registry = createRegistry({
      'display.keep_awake': defineSetting({ scopes: ['device'], type: boolType, default: false, label: 'Keep awake' }),
    });
    expect(registry.get('display.keep_awake').key).toBe('display.keep_awake');
    expect(registry.keys()).toEqual(['display.keep_awake']);
  });

  it('refuses a key that is not lower-case dotted segments', () => {
    for (const key of ['Display.KeepAwake', 'display keep awake', '1display', 'display..keep', 'display.']) {
      expect(() =>
        createRegistry({ [key]: defineSetting({ scopes: ['device'], type: boolType, default: false, label: 'x' }) })
      ).toThrow(/not a valid key/);
    }
  });

  it('refuses a setting no layer may hold', () => {
    expect(() =>
      createRegistry({ 'a.b': defineSetting({ scopes: [], type: boolType, default: false, label: 'x' }) })
    ).toThrow(/declares no scopes/);
  });

  it('refuses an unknown or repeated scope', () => {
    expect(() =>
      createRegistry({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'a.b': defineSetting({ scopes: ['galley' as any], type: boolType, default: false, label: 'x' }),
      })
    ).toThrow(/unknown scope/);
    expect(() =>
      createRegistry({
        'a.b': defineSetting({ scopes: ['device', 'device'], type: boolType, default: false, label: 'x' }),
      })
    ).toThrow(/twice/);
  });

  describe('the default must satisfy its own type', () => {
    it('catches a port declared as something that is not one', () => {
      expect(() =>
        createRegistry({
          'nmea.gateway.port': defineSetting({ scopes: ['vessel'], type: portType, default: 0, label: 'Port' }),
        })
      ).toThrow(/is not a valid port/);
    });

    it('catches an address that is not one', () => {
      expect(() =>
        createRegistry({
          'nmea.gateway.host': defineSetting({
            scopes: ['vessel'],
            type: hostType,
            default: 'tcp://10.10.10.1:11102',
            label: 'Host',
          }),
        })
      ).toThrow(/is not a valid host/);
    });

    it('checks both branches of a platform-dependent default', () => {
      // The branch that only runs on a phone is the one nobody exercises before release.
      expect(() =>
        createRegistry({
          'nmea.gateway.port': defineSetting({
            scopes: ['device'],
            type: portType,
            default: (platform) => (platform.native ? 0 : 11102),
            label: 'Port',
          }),
        })
      ).toThrow(/native: true/);
    });

    it('accepts a platform-dependent default when both branches are valid', () => {
      const registry = createRegistry({
        'vhf.monitor_audio': defineSetting({
          scopes: ['device'],
          type: boolType,
          default: (platform) => !platform.native,
          label: 'Monitor audio',
        }),
      });
      const spec = registry.get('vhf.monitor_audio');
      expect(defaultFor(spec, { native: false })).toBe(true);
      expect(defaultFor(spec, { native: true })).toBe(false);
    });
  });

  it('throws for a key nobody declared, rather than reading as unset', () => {
    const registry = createRegistry({
      'a.b': defineSetting({ scopes: ['device'], type: stringType(), default: 'x', label: 'x' }),
    });
    expect(registry.has('a.c')).toBe(false);
    expect(() => registry.get('a.c')).toThrow(/not a declared setting/);
  });

  it('keeps int bounds out of the default', () => {
    expect(() =>
      createRegistry({
        'display.day_brightness': defineSetting({
          scopes: ['device'],
          type: intType({ min: 20, max: 100 }),
          default: 5,
          label: 'Day brightness',
        }),
      })
    ).toThrow(/is not a valid int/);
  });
});
