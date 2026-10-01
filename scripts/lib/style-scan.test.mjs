import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jsxTagEnd, buttonLabel, glowsIn, arbitraryShadowValue, shadowDeclarations,
  smallTypeClasses, isPhoneOnlyTwelve, enclosingString,
} from './style-scan.mjs';

/*
  The regression. `<button\b[^>]{0,600}?` ended this tag at the `>` of the
  arrow, so the class list after it was never read.
*/
test('jsxTagEnd skips an arrow function in an attribute expression', () => {
  const src = '<button onClick={() => save()} className="bg-green">Save</button>';
  assert.equal(src.slice(0, jsxTagEnd(src, 0) + 1), '<button onClick={() => save()} className="bg-green">');
});

test('jsxTagEnd copes with nested braces, strings, templates and comments holding > and }', () => {
  const src = `<button
    onClick={async () => { if (a > b) { go({ x: '}' }); } /* > */ }}
    title="a > b"
    className={\`px-2 \${on ? 'bg-red' : '}'}\`}
  >x</button>`;
  const end = jsxTagEnd(src, 0);
  assert.equal(src.slice(end, end + 2), '>x', 'the tag ends at its own >, after every attribute');
});

test('jsxTagEnd finds a self-closing tag and gives up on an unterminated one', () => {
  assert.equal(jsxTagEnd('<Button size="dense" />', 0), 22);
  assert.equal(jsxTagEnd('<button onClick={() => {', 0), -1);
});

test('buttonLabel reads text, and the strings an expression can render', () => {
  assert.equal(buttonLabel('\n  <Trash2 size={16} />\n  Clear\n'), 'Clear');
  assert.equal(buttonLabel("{busy ? <Spinner /> : <Play />}{busy ? 'Saving' : 'Save'}"), 'Saving Save');
  assert.equal(buttonLabel('{open && <span className="x">Close</span>}'), 'Close');
  assert.equal(buttonLabel('{`Delete all ${n} recordings`}'), 'Delete all recordings');
});

test('buttonLabel is empty for an icon-only button', () => {
  assert.equal(buttonLabel('<X size={14} aria-label="Close" />'), '');
  assert.equal(buttonLabel('{open ? <ChevronDown /> : <ChevronRight />}'), '');
  assert.equal(buttonLabel('{count}'), '');
  assert.equal(buttonLabel('<Icon onClick={() => a} />'), '', 'an arrow in a child tag is not a label');
});

test('glowsIn: a zero-offset blur in a colour is a glow', () => {
  assert.equal(glowsIn('0 0 6px rgba(34,211,238,0.8)').length, 1);
  assert.equal(glowsIn('0 0 8px color-mix(in srgb, ${palette.ink} 55%, transparent)').length, 1);
  assert.equal(glowsIn('0 0 8px').length, 1, 'no colour is currentColor');
  assert.equal(glowsIn('inset 0 0 12px #4cd7f6').length, 1);
  assert.equal(glowsIn('0 4px 16px rgba(0,0,0,.35), 0 0 10px #22d3ee').length, 1, 'one layer of two');
});

test('glowsIn: any --color-*-glow token is a glow, whatever its geometry', () => {
  assert.equal(glowsIn('0 2px 8px var(--color-cyan-glow)').length, 1);
  assert.equal(glowsIn('var(--color-warning-glow)').length, 1);
});

test('glowsIn: black, --bg-app, transparent, rings, offsets and the panel shadow are not glows', () => {
  for (const v of [
    '0 0 3px rgba(0,0,0,0.85)', '0 0 2px rgb(0 0 0 / 0.5)', '0 0 1px var(--bg-app)', '0 0 4px #000',
    '0 0 4px black', '0 0 6px transparent', 'inset 0 0 0 1.5px rgba(255,255,255,0.55)', '0 0 0 1px var(--border-color)',
    '0 4px 12px rgba(0,0,0,0.7)', 'var(--panel-shadow)', 'none', '${shadow}',
  ]) {
    assert.deepEqual(glowsIn(v), [], v);
  }
});

test('arbitraryShadowValue turns a Tailwind class into CSS', () => {
  assert.equal(arbitraryShadowValue('shadow-[0_0_8px_rgba(0,0,0,0.5)]'), '0 0 8px rgba(0,0,0,0.5)');
  assert.equal(arbitraryShadowValue('drop-shadow-[0_0_2px_var(--bg-app)]'), '0 0 2px var(--bg-app)');
  assert.equal(arbitraryShadowValue('shadow-lg'), null);
});

test('shadowDeclarations finds CSS, style objects, HTML strings and drop-shadow()', () => {
  const src = [
    '.a { box-shadow: 0 0 4px red; }',
    "style={{ boxShadow: on ? '0 0 2px #fff' : 'none', color: 'red' }}",
    'html: `<span style="box-shadow:0 0 8px color-mix(in srgb, ${ink} 55%, transparent);">`',
    'filter: drop-shadow(0 0 1px var(--bg-app)) drop-shadow(0 0 3px rgba(0,0,0,0.85));',
    "transition: 'box-shadow 0.2s'",
  ].join('\n');
  assert.deepEqual(shadowDeclarations(src).map((d) => d.value.trim()).sort(), [
    '0 0 1px var(--bg-app)',
    '0 0 2px #fff',
    '0 0 3px rgba(0,0,0,0.85)',
    '0 0 4px red',
    '0 0 8px color-mix(in srgb, ${ink} 55%, transparent)',
    'none',
  ]);
});

test('smallTypeClasses reports text-[Npx] under 13 and text-xs, with their prefix', () => {
  const hits = smallTypeClasses('a text-[12px] sm:text-[13px] md:text-xs text-[12.5px] text-[14px] text-xs-foo [&>svg]:text-[10px]');
  assert.deepEqual(hits.map((h) => [h.cls, h.prefix, h.px]), [
    ['text-[12px]', '', 12],
    ['md:text-xs', 'md:', 12],
    ['text-[12.5px]', '', 12.5],
    ['[&>svg]:text-[10px]', '[&>svg]:', 10],
  ]);
});

test('isPhoneOnlyTwelve: an unprefixed 12 with an sm: step of 13 or more in the same string', () => {
  const ok = (src, steps) => {
    const [hit] = smallTypeClasses(src);
    return isPhoneOnlyTwelve(src, hit, new Set(steps));
  };
  assert.equal(ok('<t className="text-[12px] sm:text-[13px]">'), true);
  assert.equal(ok('<t className="w-full text-xs sm:text-sm">'), true);
  assert.equal(ok('<t className="text-[12px] sm:text-body-sm">', ['text-body-sm']), true);
  assert.equal(ok('<t className={`text-[12px] ${a} sm:text-[15px]`}>'), true);
  assert.equal(ok('<t className="text-[12px] w-full">'), false, 'bare');
  assert.equal(ok('<t className="text-[12px] sm:text-[12px]">'), false, 'sm step under the floor');
  assert.equal(ok('<t className="text-[12px] md:text-[13px]">'), false, 'md is not sm');
  assert.equal(ok('<t className="text-[11px] sm:text-[13px]">'), false, '11 is not the exception');
  assert.equal(ok('<t className="text-[12px]" data-x="sm:text-[13px]">'), false, 'another string');
  assert.equal(ok('<t className="text-[12px] sm:text-body-sm">'), false, 'an unknown named step');
});

test('enclosingString finds the quoted string around an offset on its line', () => {
  const src = 'a("x y", `p q`)';
  assert.deepEqual(enclosingString(src, src.indexOf('y')), [3, 6]);
  assert.deepEqual(enclosingString(src, src.indexOf('q')), [10, 13]);
  assert.equal(enclosingString(src, src.indexOf(',')), null);
});
