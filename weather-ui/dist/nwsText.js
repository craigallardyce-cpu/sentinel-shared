/**
 * NWS forecast and alert prose, in sentence case for display.
 *
 * NWS marine products arrive in capitals ("PATCHY FOG AFTER 1AM. SW WINDS
 * 10 KT."), a teletype convention. Set on screen it is shouting, and capitals
 * are slower to read than mixed case -- on the one panel someone reads when the
 * weather has turned. The fleet's rule is sentence case everywhere except the
 * label over an instrument (fit-and-finish, 2026-09-30).
 *
 * So text that is (almost) all capitals is lowercased, the start of each
 * sentence is capitalised, and the words that are capitals in ordinary writing
 * are put back: compass points, the agencies, time zones, radio systems, and
 * the names of days and months. Units take their usual lower case (kt, mph,
 * ft, nm, am, pm). Text that already has lower case -- the NWS land zone
 * forecasts do -- is returned unchanged, so a place name written properly
 * upstream is never flattened.
 *
 * What this cannot do: a place name in a capitals product ("BLOCK ISLAND
 * SOUND") comes out lower case ("block island sound"), because nothing here can
 * tell it from an ordinary word. Hosts keep the original in a `title` so it is
 * always one hover away.
 */
/** Words that stay in capitals. Lower-case keys; looked up by the lowered word. */
const UPPER = new Set([
    // Compass points, all sixteen.
    'n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse',
    's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw',
    // Agencies and services.
    'nws', 'noaa', 'nhc', 'opc', 'spc', 'wpc', 'uscg', 'gmdss', 'navtex', 'vhf', 'ais', 'gps',
    // Time zones.
    'utc', 'gmt', 'est', 'edt', 'cst', 'cdt', 'mst', 'mdt', 'pst', 'pdt', 'akst', 'akdt', 'hst', 'ast', 'chst', 'sst',
]);
/** Words that take an initial capital: days and months. */
const PROPER = new Set([
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'june', 'july', 'august',
    'september', 'october', 'november', 'december',
    // "May" is left out on purpose: it is far more often the verb.
]);
const capitalise = (w) => w.charAt(0).toUpperCase() + w.slice(1);
/** True when the text is written in capitals: at least 80% of its letters are. */
export function isShouting(text) {
    const letters = text.match(/[A-Za-z]/g);
    if (!letters || letters.length < 3)
        return false;
    const upper = letters.filter((c) => c >= 'A' && c <= 'Z').length;
    return upper / letters.length >= 0.8;
}
/**
 * Sentence case for NWS prose. Mixed-case text comes back unchanged (trimmed);
 * capitals are converted as described above.
 */
export function nwsSentenceCase(text) {
    const src = (text ?? '').trim();
    if (!src || !isShouting(src))
        return src;
    // Words, with an apostrophe-led tail left alone ("BOAT'S" must not give an
    // upper-case S for south).
    let out = src.toLowerCase().replace(/(?<!['’])\b([a-z]+)\b/g, (word) => {
        if (UPPER.has(word))
            return word.toUpperCase();
        if (PROPER.has(word))
            return capitalise(word);
        return word;
    });
    // "U.S." is written with stops, so it is not one word to the pass above.
    out = out.replace(/\bu\.s\.(?=\s|$|[,;:])/g, 'U.S.');
    // Sentence starts: the first letter of the text, and the first letter after
    // a full stop, question or exclamation mark followed by space, or after a
    // line break. NWS headlines open with "..." -- the first letter after them
    // is still the start. The last stop of "U.S." ends an abbreviation, not a
    // sentence.
    out = out.replace(/^([^A-Za-z]*)([a-z])/, (_, lead, c) => lead + c.toUpperCase());
    out = out.replace(/(?<!\bU\.S)([.!?]\s+|\n\s*)([^A-Za-z\s]*)([a-z])/g, (_, gap, lead, c) => gap + lead + c.toUpperCase());
    return out;
}
