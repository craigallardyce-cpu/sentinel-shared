/**
 * Matching helpers for the drift checker's theme and type rules (section 12):
 * where a JSX opening tag really ends, which class string a hit sits in, and
 * whether a shadow is a glow.
 *
 * They live here, not inline in the checker, for the same reason yaml-scan.mjs
 * does: each was wrong once in a way only a unit test shows. RAW_ACCENT_BUTTON
 * used to end a tag at the first `>`, which in `onClick={() => save()}` is the
 * arrow, so most of the fleet's buttons were never examined at all -- and the
 * count it reported looked plausible, which is why nobody noticed.
 */

/** Skip a '…' or "…" string starting at `i`; returns the index after it. */
function skipQuoted(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === q) return j + 1;
    if (src[j] === '\n') return j; // an unterminated string in JS is a syntax error; stop at the line
    j++;
  }
  return j;
}

/** Skip a `…` template literal starting at `i`, including any ${…} inside it. */
function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '`') return j + 1;
    if (src[j] === '$' && src[j + 1] === '{') { j = skipExpression(src, j + 1); continue; }
    j++;
  }
  return j;
}

/**
 * Skip a balanced {…} expression starting at the `{` at `i`; returns the index
 * after its closing brace. Strings, template literals and comments inside it are
 * skipped whole, so a `}` or a `>` inside one of those does not count.
 */
export function skipExpression(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") { j = skipQuoted(src, j); continue; }
    if (c === '`') { j = skipTemplate(src, j); continue; }
    if (c === '/' && src[j + 1] === '/') { const e = src.indexOf('\n', j); j = e === -1 ? src.length : e; continue; }
    if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e === -1 ? src.length : e + 2; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return j;
}

/**
 * The index of the `>` that closes the JSX opening tag starting at the `<` at
 * `start`, or -1. Attribute values in quotes and attribute expressions in
 * braces are skipped whole, so `onClick={() => go()}` and `title="a > b"` do
 * not end the tag early. A self-closing tag's index is that of its `>` too.
 */
export function jsxTagEnd(src, start, limit = 6000) {
  let i = start + 1;
  const stop = Math.min(src.length, start + limit);
  while (i < stop) {
    const c = src[i];
    if (c === '>') return i;
    if (c === '"' || c === "'") { i = skipQuoted(src, i); continue; }
    if (c === '{') { i = skipExpression(src, i); continue; }
    i++;
  }
  return -1;
}

/**
 * The string literal (quoted or template) that contains `index`, as
 * [start, end) offsets of its contents, or null when `index` is not inside one
 * on the same line. "The same class string" means this, and only this: a
 * `text-[12px]` and an `sm:text-[13px]` two props apart are not one decision.
 */
export function enclosingString(src, index) {
  const lineStart = src.lastIndexOf('\n', index - 1) + 1;
  // Walk the line from its start, tracking which quote we are inside.
  let open = -1;
  let q = null;
  for (let j = lineStart; j < index; j++) {
    const c = src[j];
    if (q) {
      if (c === '\\') { j++; continue; }
      if (c === q) { q = null; open = -1; }
    } else if (c === '"' || c === "'" || c === '`') {
      q = c; open = j;
    }
  }
  if (!q) return null;
  let end = index;
  while (end < src.length && src[end] !== q && src[end] !== '\n') {
    if (src[end] === '\\') end++;
    end++;
  }
  return [open + 1, end];
}

// ---------------------------------------------------------------------------
// Shadows.
// ---------------------------------------------------------------------------

/** Split on top-level commas: not inside (), and not inside ${}. */
function splitTopLevel(value, sep = ',') {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Tokens of one shadow layer: functions, ${…} and words, split on spaces. */
function tokens(layer) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of layer) {
    if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') depth--;
    if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

const LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vh|vw)?$/;

/**
 * The colours a glow may be drawn in: black, the app's own background, and
 * transparent (which draws nothing). These are legibility halos -- a map marker
 * or a label kept readable over a busy chart -- not light coming off a control.
 */
const NEUTRAL_GLOW = [
  /^#000(?:0{3})?(?:[0-9a-f]{2})?$/i,
  /^#000[0-9a-f]?$/i,
  /^black$/i,
  /^transparent$/i,
  /^rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\b[^)]*\)$/i,
  /^var\(\s*--bg-app\s*(?:,[^)]*)?\)$/i,
  /^var\(--panel-shadow\)$/i,
];

/**
 * White, as well, behind text only. A dark label drawn on a light chart is
 * haloed in white for the same reason a light one is haloed in black
 * (OceanSentinel's range-ring labels on the vector and ENC charts). Behind a
 * box it is still a glow.
 */
const NEUTRAL_TEXT_HALO = [
  /^#fff(?:fff)?(?:[0-9a-f]{2})?$/i,
  /^white$/i,
  /^rgba?\(\s*255\s*[, ]\s*255\s*[, ]\s*255\b[^)]*\)$/i,
];

const GLOW_TOKEN = /--color-[a-z0-9-]+-glow\b/;

/**
 * Glows in a CSS shadow value (box-shadow, or one drop-shadow()'s arguments):
 * a layer with no offset, a blur, and a colour that is not neutral. A zero-blur
 * layer is a ring -- a stroke -- and is allowed: state is fill and stroke. A
 * layer naming a `--color-*-glow` token is a glow whatever its geometry: those
 * tokens are transparent and deprecated. Returns one string per glowing layer.
 * With `text`, the value is a text shadow, and a white halo is neutral too.
 */
export function glowsIn(value, { text = false } = {}) {
  const neutralColours = text ? [...NEUTRAL_GLOW, ...NEUTRAL_TEXT_HALO] : NEUTRAL_GLOW;
  const found = [];
  for (const layer of splitTopLevel(value)) {
    if (GLOW_TOKEN.test(layer)) { found.push(layer); continue; }
    const toks = tokens(layer).filter((t) => t.toLowerCase() !== 'inset' && t !== '!important');
    const lengths = [];
    const colours = [];
    for (const t of toks) {
      if (LENGTH.test(t)) lengths.push(parseFloat(t));
      else colours.push(t);
    }
    // Not a shadow we can read the geometry of (`none`, a bare var(), a whole
    // value interpolated from JS). Nothing to judge.
    if (lengths.length < 2) continue;
    const [x, y, blur = 0] = lengths;
    if (x !== 0 || y !== 0 || !(blur > 0)) continue;
    // No colour means currentColor, which is whatever the text is: coloured.
    const neutral = colours.length > 0 && colours.every((c) => neutralColours.some((re) => re.test(c)));
    if (!neutral) found.push(layer);
  }
  return found;
}

/** The value inside a Tailwind arbitrary shadow class, as CSS. */
export function arbitraryShadowValue(cls) {
  const m = /^(?:drop-)?shadow-\[(.*)\]$/.exec(cls);
  return m ? m[1].replace(/_/g, ' ') : null;
}

/**
 * Every shadow value written in a source file, outside Tailwind classes: CSS
 * `box-shadow:` and `text-shadow:` declarations (in a stylesheet, or in an HTML
 * string such as a Leaflet divIcon), React `boxShadow:` and `textShadow:` style
 * values, and the arguments of each `drop-shadow(…)` filter. Returns
 * [{ index, value, text }], `text` true for a text shadow (see glowsIn).
 *
 * `text-shadow` was added on 2026-10-31: a glow drawn behind a label is a glow
 * as much as one drawn behind a box, and OceanSentinel's chart labels carried
 * one the class-name scan could not see.
 */
export function shadowDeclarations(src) {
  const out = [];
  // A ${…} inside the value is kept whole: it is usually the colour.
  for (const m of src.matchAll(/(?<![\w-])(?:-webkit-)?(box|text)-shadow\s*:\s*((?:[^;"'`}\n$]|\$(?!\{)|\$\{[^}]*\})*)/g)) {
    out.push({ index: m.index, value: m[2], text: m[1] === 'text' });
  }
  // `boxShadow:` in a style object. Its value is an expression -- a string, or
  // a ternary choosing between strings -- so every string literal up to the
  // end of the property is a candidate value.
  for (const m of src.matchAll(/\b(box|text)Shadow\s*:/g)) {
    const text = m[1] === 'text';
    let j = m.index + m[0].length;
    const stop = Math.min(src.length, j + 400);
    let depth = 0;
    while (j < stop) {
      const c = src[j];
      if (c === '"' || c === "'" || c === '`') {
        const end = c === '`' ? skipTemplate(src, j) : skipQuoted(src, j);
        out.push({ index: m.index, value: src.slice(j + 1, end - 1), text });
        j = end;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
      j++;
    }
  }
  // drop-shadow( with one level of nested parentheses (rgba(), var()).
  for (const m of src.matchAll(/(?<![\w-])drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g)) {
    out.push({ index: m.index, value: m[1], text: false });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The type floor.
// ---------------------------------------------------------------------------

/** The fleet's reading floor, in px (@sentinel/theme/type.css). */
export const TYPE_FLOOR = 13;

/** Tailwind's own text steps at or above the floor. `text-xs` (12px) is not one. */
const TAILWIND_STEPS_AT_FLOOR = new Set(['text-sm', 'text-base', 'text-lg', 'text-xl', ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `text-${n}xl`)]);

/**
 * Every type size under the floor written as a Tailwind class: a hand-written
 * `text-[Npx]` below 13, and `text-xs`. Returns [{ index, cls, prefix, px }],
 * where `prefix` is the variant chain (`sm:`, `hover:`…), empty at rest.
 */
export function smallTypeClasses(src, floor = TYPE_FLOOR) {
  const out = [];
  // Group 1 is the variant chain (`sm:`, `hover:`, `[&>svg]:`), empty at rest.
  for (const m of src.matchAll(/(?<![\w\-\[])((?:[a-z0-9-]*(?:\[[^\]\s]*\])?:)*)text-\[(\d+(?:\.\d+)?)px\]/g)) {
    const px = parseFloat(m[2]);
    if (px < floor) out.push({ index: m.index, cls: m[0], prefix: m[1], px });
  }
  for (const m of src.matchAll(/(?<![\w\-\[])((?:[a-z0-9-]*(?:\[[^\]\s]*\])?:)*)text-xs(?![\w-])/g)) {
    out.push({ index: m.index, cls: m[0], prefix: m[1], px: 12 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Every type size under the floor written outside a Tailwind class, in a
 * script or component file: a CSS `font-size:` or `font:` shorthand inside a
 * string (the HTML of a Leaflet divIcon, a style attribute), and -- in a
 * `.jsx`/`.tsx` file -- a React `fontSize:` style value or an SVG `fontSize=`
 * attribute. Returns [{ index, text, px }].
 *
 * The class-name scan cannot see any of these, so OceanSentinel's 10 and 11px
 * chart annotations passed unchecked until 2026-10-31. A `fontSize:` in a
 * plain `.js`/`.ts` file is not read: there it is as likely to be a PDF
 * writer's point size (VesselKeeper's reports) as a screen's.
 *
 * A size interpolated from a ternary, `${major ? 11 : 10}px`, is judged by its
 * smaller branch. Any other expression is not read.
 */
export function inlineFontSizes(code, { jsx = false, floor = TYPE_FLOOR } = {}) {
  const out = [];
  const push = (index, text, px) => { if (px < floor) out.push({ index, text, px }); };
  // The size before `px`: a number, or a ${cond ? a : b} interpolation.
  const SIZE = '(\\d+(?:\\.\\d+)?|\\$\\{[^}]*\\})px';
  const sizeOf = (tok) => {
    if (!tok.startsWith('${')) return parseFloat(tok);
    const branches = [...tok.matchAll(/[?:]\s*(\d+(?:\.\d+)?)\s*(?=[:}])/g)].map((b) => parseFloat(b[1]));
    return branches.length ? Math.min(...branches) : Infinity;
  };
  for (const m of code.matchAll(new RegExp(`(?<![\\w-])font-size\\s*:\\s*${SIZE}`, 'g'))) {
    push(m.index, m[0], sizeOf(m[1]));
  }
  // The shorthand: `font: 700 10px/1.35 monospace`. Its size is the first
  // length, after an optional style and weight (either may be interpolated).
  for (const m of code.matchAll(new RegExp(`(?<![\\w-])font\\s*:\\s*(?:[a-z0-9]+\\s+|\\$\\{[^}]*\\}\\s+){0,3}${SIZE}`, 'gi'))) {
    push(m.index, m[0], sizeOf(m[1]));
  }
  if (jsx) {
    for (const m of code.matchAll(/\bfontSize\s*:\s*(?:(\d+(?:\.\d+)?)(?![\w.])(?!\s*[-+*/?])|(['"`])(\d+(?:\.\d+)?)(?:px)?\2)/g)) {
      push(m.index, m[0], parseFloat(m[1] ?? m[3]));
    }
    for (const m of code.matchAll(/\bfontSize\s*=\s*(?:\{\s*)?(['"]?)(\d+(?:\.\d+)?)(?:px)?\1\s*\}?(?=[\s/>])/g)) {
      push(m.index, m[0], parseFloat(m[2]));
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * VesselKeeper's one exception to the floor: 12px below the `sm` breakpoint
 * only, where four full tab and table labels have to share a phone's width. It
 * is recognised only in its written form -- an unprefixed 12 (`text-[12px]` or
 * `text-xs`) in the same class string as an `sm:` text size of at least 13, as
 * in `text-[12px] sm:text-[13px]` -- so a bare 12, or a 12 at `sm` and up, is
 * still under the floor. `namedSteps` is the set of @sentinel/theme type
 * utilities (`text-body-sm`…), all of which sit at or above the floor.
 */
export function isPhoneOnlyTwelve(src, hit, namedSteps = new Set(), floor = TYPE_FLOOR) {
  if (hit.px !== 12 || hit.prefix !== '') return false;
  const range = enclosingString(src, hit.index);
  if (!range) return false;
  const str = src.slice(range[0], range[1]);
  for (const m of str.matchAll(/(?<![\w-])sm:text-(\[(\d+(?:\.\d+)?)px\]|[a-z0-9-]+)(?![\w-])/g)) {
    if (m[2] !== undefined) {
      if (parseFloat(m[2]) >= floor) return true;
      continue;
    }
    const cls = `text-${m[1]}`;
    if (TAILWIND_STEPS_AT_FLOOR.has(cls) || namedSteps.has(cls)) return true;
  }
  return false;
}

/** The marker that records a hand-written type size as a decision, not drift. */
export const TYPE_SIZE_APPROVED = 'type-size-approved';

/**
 * Whether the hand-written type size at `index` carries a
 * `type-size-approved: why` comment, either on its own line or in the comment
 * directly above it (a `//` run, a block comment, or a JSX `{/* … *\/}` child).
 * `code` is `src` with comments blanked, offsets kept, which is how a comment
 * line is told from code. A blank line or any code ends the search, so one
 * marker covers one site, and the reason is required: a bare marker approves
 * nothing.
 *
 * This only silences the burndown count. A size under the floor fails whatever
 * a comment says (smallTypeClasses), apart from VesselKeeper's phone-only 12.
 */
export function isApprovedTypeSize(src, code, index) {
  const marker = new RegExp(`${TYPE_SIZE_APPROVED}\\s*:\\s*\\S`);
  const srcLines = src.split('\n');
  const codeLines = code.split('\n');
  let line = src.slice(0, index).split('\n').length - 1;
  if (marker.test(srcLines[line])) return true;
  for (line -= 1; line >= 0; line--) {
    if (!srcLines[line].trim()) return false;
    // What is left of the line once its comments are blanked: nothing, or the
    // braces of a JSX comment child.
    if (!/^[\s{}]*$/.test(codeLines[line] ?? '')) return false;
    if (marker.test(srcLines[line])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Buttons.
// ---------------------------------------------------------------------------

/** Skip the JSX tag (opening, closing or self-closing) at `i`; -1 if there is none. */
function skipTag(src, i) {
  if (src[i] !== '<') return -1;
  const next = src[i + 1] ?? '';
  if (next === '/') { const e = src.indexOf('>', i); return e === -1 ? src.length : e + 1; }
  if (/[A-Za-z>]/.test(next)) { const e = jsxTagEnd(src, i); return e === -1 ? src.length : e + 1; }
  return -1;
}

/**
 * The words a button's children would show: JSX text, plus any string literal
 * or JSX text an expression child can render (`{busy ? 'Saving' : 'Save'}`,
 * `{open && <span>Close</span>}`). Tags, their attributes and everything else
 * an expression computes are dropped. An empty result is an icon-only button.
 */
export function buttonLabel(body) {
  const words = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '<') {
      const e = skipTag(body, i);
      if (e !== -1) { i = e; continue; }
    }
    if (c === '{') {
      const end = skipExpression(body, i);
      words.push(expressionText(body.slice(i + 1, end - 1)));
      i = end;
      continue;
    }
    words.push(c);
    i++;
  }
  return words.join('').replace(/\s+/g, ' ').trim();
}

function expressionText(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '<') {
      const e = skipTag(expr, i);
      if (e !== -1) {
        // JSX text directly after a tag, up to the next tag or expression.
        const stop = expr.slice(e).search(/[<{]/);
        const text = stop === -1 ? expr.slice(e) : expr.slice(e, e + stop);
        if (/[A-Za-z]/.test(text) && !/[;=()]/.test(text)) out.push(text);
        i = e;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      const end = skipQuoted(expr, i);
      out.push(expr.slice(i + 1, end - 1));
      i = end;
      continue;
    }
    if (c === '`') {
      const end = skipTemplate(expr, i);
      out.push(expr.slice(i + 1, end - 1).replace(/\$\{[^}]*\}/g, ''));
      i = end;
      continue;
    }
    if (c === '{') {
      const end = skipExpression(expr, i);
      out.push(expressionText(expr.slice(i + 1, end - 1)));
      i = end;
      continue;
    }
    i++;
  }
  return out.filter((s) => /[A-Za-z]/.test(s)).join(' ');
}
