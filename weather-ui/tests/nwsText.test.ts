import { describe, expect, it } from 'vitest';
import { nwsSentenceCase, isShouting } from '../src/nwsText';

describe('nwsSentenceCase', () => {
  it('puts a capitals forecast into sentence case, sentence by sentence', () => {
    expect(nwsSentenceCase('PARTLY SUNNY, WITH A HIGH NEAR 67. SOUTHWEST WIND 6 TO 13 MPH.'))
      .toBe('Partly sunny, with a high near 67. Southwest wind 6 to 13 mph.');
    expect(nwsSentenceCase('PATCHY FOG AFTER 1AM. PARTLY CLOUDY, WITH A LOW AROUND 64.'))
      .toBe('Patchy fog after 1am. Partly cloudy, with a low around 64.');
  });

  it('keeps compass points, agencies and time zones in capitals, and units in lower case', () => {
    expect(nwsSentenceCase('SW WINDS 10 TO 15 KT, BECOMING NNE. SEAS 2 TO 4 FT.'))
      .toBe('SW winds 10 to 15 kt, becoming NNE. Seas 2 to 4 ft.');
    expect(nwsSentenceCase('ISSUED BY NWS BOSTON AT 4 AM EDT. MONITOR VHF CHANNEL 16.'))
      .toBe('Issued by NWS boston at 4 am EDT. Monitor VHF channel 16.');
    expect(nwsSentenceCase('WINDS E 5 KT. WAVES 1 FT OR LESS. N SWELL.'))
      .toBe('Winds E 5 kt. Waves 1 ft or less. N swell.');
  });

  it('capitalises days and months, but not "may" the verb', () => {
    expect(nwsSentenceCase('SHOWERS LIKELY FRIDAY. CONDITIONS MAY IMPROVE BY OCTOBER 7.'))
      .toBe('Showers likely Friday. Conditions may improve by October 7.');
  });

  it('does not read a possessive s as south', () => {
    expect(nwsSentenceCase("THE BOAT'S MOORING")).toBe("The boat's mooring");
  });

  it('capitalises the first letter after the NWS leading dots and after a line break', () => {
    expect(nwsSentenceCase('...SMALL CRAFT ADVISORY IN EFFECT UNTIL 6 PM EDT...'))
      .toBe('...Small craft advisory in effect until 6 pm EDT...');
    expect(nwsSentenceCase('WIND SW 10 KT\nSEAS 3 FT')).toBe('Wind SW 10 kt\nSeas 3 ft');
  });

  it('keeps U.S. with its stops', () => {
    expect(nwsSentenceCase('U.S. COASTAL WATERS')).toBe('U.S. coastal waters');
  });

  it('leaves mixed-case text exactly as written, so proper names survive', () => {
    const text = 'Partly sunny, with a high near 67. Southwest wind 6 to 13 mph near Block Island.';
    expect(nwsSentenceCase(text)).toBe(text);
  });

  it('is safe on empty and missing input', () => {
    expect(nwsSentenceCase('')).toBe('');
    expect(nwsSentenceCase(undefined)).toBe('');
    expect(nwsSentenceCase(null)).toBe('');
    expect(nwsSentenceCase('  ')).toBe('');
  });
});

describe('isShouting', () => {
  it('is true for capitals and false for mixed case or too little text', () => {
    expect(isShouting('GALE WARNING')).toBe(true);
    expect(isShouting('Gale warning')).toBe(false);
    expect(isShouting('SW')).toBe(false);
    expect(isShouting('42 / 17')).toBe(false);
  });
});
