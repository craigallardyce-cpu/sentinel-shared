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
/** True when the text is written in capitals: at least 80% of its letters are. */
export declare function isShouting(text: string): boolean;
/**
 * Sentence case for NWS prose. Mixed-case text comes back unchanged (trimmed);
 * capitals are converted as described above.
 */
export declare function nwsSentenceCase(text: string | null | undefined): string;
