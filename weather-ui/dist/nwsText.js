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
/*
  Proper nouns. Not solved in general -- nothing can tell "SOUND" the place from
  "sound" the word -- but three cheap sources cover most of what a reader sees:

    1. The issuing office. "ISSUED BY NWS BOSTON/NORTON MA" names a place right
       after NWS, so up to three words after it are capitalised, stopping at
       the first ordinary word ("at", "until"…) or punctuation; a two-letter
       state code among them goes back to capitals.
    2. Names the host already knows: the forecast's location and zone
       (`locName`, `marineZone`), passed as `names`. The whole name and each
       comma-separated part are matched case-insensitively, as whole words,
       and put back as written: "Newport, RI" returns with its state code
       (a long name given in capitals comes back in title case).
    3. A short list of the marine-text names the fleet's own areas use, and
       any NWS zone code (ANZ236).
*/
const OFFICE_STOP = new Set([
    'at', 'until', 'for', 'in', 'on', 'and', 'the', 'from', 'to', 'by', 'of', 'with', 'is', 'has', 'this', 'tonight', 'today',
]);
const STATES = new Set([
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md',
    'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
    'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'pr', 'vi', 'gu',
]);
/** Places that recur in the fleet's NWS marine text. Kept short on purpose. */
const KNOWN_PLACES = [
    'Block Island Sound', 'Block Island', 'Rhode Island Sound', 'Rhode Island', 'Narragansett Bay', 'Buzzards Bay',
    "Martha's Vineyard", 'Nantucket Sound', 'Nantucket', 'Vineyard Sound', 'Long Island Sound', 'Long Island',
    'Cape Cod Bay', 'Cape Cod', 'Montauk Point', 'Point Judith', 'Watch Hill', 'Newport', 'Boston', 'Gulf of Maine',
    'Gulf Stream', 'Chesapeake Bay', 'Delaware Bay', 'Gulf of Mexico', 'Atlantic', 'Florida Keys',
];
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/'-])([a-z])/g, (_, a, c) => a + c.toUpperCase());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/*
  Two-letter words that are also state codes. A host's "Portland, OR" must not
  turn every "or" in the forecast into "OR", so a short part that is one of
  these is restored only where it follows its own place ("Portland, OR"),
  never on its own. Any other short all-capitals part (RI, MA, NY) is
  restored wherever it stands as a word.
*/
const SHORT_WORDS = new Set([
    'al', 'am', 'as', 'at', 'be', 'by', 'co', 'de', 'do', 'go', 'he', 'hi', 'id', 'if', 'in', 'is', 'it', 'la', 'me',
    'my', 'no', 'of', 'oh', 'ok', 'on', 'or', 'pa', 'pm', 'so', 'to', 'up', 'us', 'we',
]);
/** How a part is written back: as given, or in title case if given in capitals as a name (not a code). */
function writtenForm(part) {
    const letters = part.replace(/[^A-Za-z]/g, '');
    if (/\d/.test(part) || letters.length <= 3)
        return part; // RI, MA, ANZ236 stay as given
    return isShouting(part) ? titleCase(part) : part;
}
function restoreNames(out, names) {
    const candidates = [];
    for (const name of [...names, ...KNOWN_PLACES]) {
        const whole = (name ?? '').trim();
        if (!/[A-Za-z]/.test(whole))
            continue;
        const parts = whole.split(',').map((p) => p.trim()).filter((p) => /[A-Za-z]/.test(p));
        // The whole name, so "Newport, RI" comes back with its state code.
        if (parts.length > 1)
            candidates.push(whole);
        for (const p of parts) {
            const letters = p.replace(/[^A-Za-z]/g, '');
            if (letters.length <= 2 && (!/^[A-Z]+$/.test(letters) || SHORT_WORDS.has(letters.toLowerCase())))
                continue;
            candidates.push(p);
        }
    }
    // Longest first, so "Block Island Sound" wins over "Block Island", and a
    // whole "Newport, RI" over its parts.
    candidates.sort((a, b) => b.length - a.length);
    for (const cand of candidates) {
        const written = cand.split(',').map((p) => writtenForm(p.trim())).join(', ');
        // Word boundaries, not a minimum length, keep "ri" inside "rising" alone.
        const body = escapeRe(cand).replace(/,\s*/g, ',\\s*');
        out = out.replace(new RegExp(`(?<![A-Za-z'])${body}(?![A-Za-z])`, 'gi'), written);
    }
    // NWS zone codes: two letters, Z, three digits.
    return out.replace(/\b([a-z]{2}z\d{3})\b/gi, (z) => z.toUpperCase());
}
function capitaliseOffice(out) {
    return out.replace(/\bNWS((?:[ /-]+[a-z]+){1,3})/g, (match, tail) => {
        let stopped = false;
        let n = 0;
        const fixed = tail.replace(/([ /-]+)([a-z]+)/g, (seg, sep, word) => {
            if (stopped || OFFICE_STOP.has(word)) {
                stopped = true;
                return seg;
            }
            // A state code follows the office's place name ("Norton MA"), never leads it.
            const state = n > 0 && STATES.has(word);
            n++;
            return sep + (state ? word.toUpperCase() : capitalise(word));
        });
        return `NWS${fixed}`;
    });
}
/**
 * Sentence case for NWS prose. Mixed-case text comes back unchanged (trimmed);
 * capitals are converted as described above.
 */
export function nwsSentenceCase(text, options = {}) {
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
    out = capitaliseOffice(out);
    return restoreNames(out, options.names ?? []);
}
/**
 * The fleet writes wind speed in "kt" (HarborSentinel's Wave 2 moved "kts" to
 * "kt", as the instrument cells write it). A host-formatted wind range such as
 * "13 kts" is shown as "13 kt"; anything else is left as given.
 */
export function windUnitKt(value) {
    return (value ?? '').replace(/(\d)\s*kts\b/gi, '$1 kt');
}
