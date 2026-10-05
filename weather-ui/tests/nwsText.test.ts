import { describe, expect, it } from 'vitest';
import { nwsSentenceCase, isShouting, windUnitKt } from '../src/nwsText';

describe('nwsSentenceCase: proper nouns', () => {
  it('capitalises the issuing office after NWS, with its state code, and stops at an ordinary word', () => {
    expect(nwsSentenceCase('ISSUED BY NWS BOSTON AT 4 AM EDT.')).toBe('Issued by NWS Boston at 4 am EDT.');
    expect(nwsSentenceCase('ISSUED BY NWS BOSTON/NORTON MA AT 345 AM EDT.'))
      .toBe('Issued by NWS Boston/Norton MA at 345 am EDT.');
    expect(nwsSentenceCase('THE NWS HAS ISSUED A GALE WARNING.')).toBe('The NWS has issued a gale warning.');
  });

  it("restores the host's area names as written, case-insensitively, longest first", () => {
    const names = ['Block Island Sound', 'ANZ235'];
    expect(nwsSentenceCase('SW WINDS 15 KT OVER BLOCK ISLAND SOUND. ZONE ANZ235.', { names }))
      .toBe('SW winds 15 kt over Block Island Sound. Zone ANZ235.');
    // A location given as "Place, ST" matches on its place part.
    expect(nwsSentenceCase('PATCHY FOG NEAR NEWPORT AFTER 1AM.', { names: ['Newport, RI'] }))
      .toBe('Patchy fog near Newport after 1am.');
    // A name given in capitals comes back in title case.
    expect(nwsSentenceCase('SEAS 3 FT IN NARRAGANSETT BAY.', { names: ['NARRAGANSETT BAY'] }))
      .toBe('Seas 3 ft in Narragansett Bay.');
  });

  it('knows the common names in the fleet’s own waters without being told, and zone codes', () => {
    expect(nwsSentenceCase("SEAS 4 FT SOUTH OF MARTHA'S VINEYARD AND NANTUCKET. SEE ANZ250."))
      .toBe("Seas 4 ft south of Martha's Vineyard and Nantucket. See ANZ250.");
  });

  it('does not touch a name inside another word', () => {
    expect(nwsSentenceCase('NEWPORTS AND BOSTONIANS.', { names: ['Newport'] })).toBe('Newports and bostonians.');
  });

  it('restores "Newport, RI" whole, state code included, and the code where it stands alone', () => {
    const names = ['Newport, RI'];
    expect(nwsSentenceCase('FOG NEAR NEWPORT, RI THIS MORNING.', { names })).toBe('Fog near Newport, RI this morning.');
    expect(nwsSentenceCase('COASTAL WATERS OF RI AND MA.', { names })).toBe('Coastal waters of RI and ma.');
  });

  it('never changes a two-letter code inside another word', () => {
    expect(nwsSentenceCase('RISING SEAS. RAIN AT TIMES.', { names: ['Newport, RI'] })).toBe('Rising seas. Rain at times.');
  });

  it('restores a code that is also a word only beside its own place, never on its own', () => {
    expect(nwsSentenceCase('RAIN OR SNOW NEAR PORTLAND, OR.', { names: ['Portland, OR'] }))
      .toBe('Rain or snow near Portland, OR.');
  });
});

describe('windUnitKt', () => {
  it('writes a host-formatted speed in kt and leaves anything else alone', () => {
    expect(windUnitKt('13 kts')).toBe('13 kt');
    expect(windUnitKt('10-15 KTS')).toBe('10-15 kt');
    expect(windUnitKt('13 kt')).toBe('13 kt');
    expect(windUnitKt('Variable')).toBe('Variable');
    expect(windUnitKt(undefined)).toBe('');
  });
});

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
      .toBe('Issued by NWS Boston at 4 am EDT. Monitor VHF channel 16.');
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
