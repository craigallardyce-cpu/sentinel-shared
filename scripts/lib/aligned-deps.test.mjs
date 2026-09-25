import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declarationsIn, compareWithPublished, unknownEntries, canonicalFrom } from './aligned-deps.mjs';

const ALIGNED = ['react', 'react-dom', 'motion'];
const decl = (app, dep, range, file = 'package.json', field = 'dependencies') => ({ app, file, field, dep, range });

test('declarationsIn reads dependencies and devDependencies separately and ignores unaligned packages', () => {
  const got = declarationsIn(
    { dependencies: { react: '^19.0.1', zod: '^3' }, devDependencies: { react: '^19.0.2' } },
    { app: 'A', file: 'package.json', alignedDeps: ALIGNED },
  );
  assert.deepEqual(got, [
    decl('A', 'react', '^19.0.1'),
    decl('A', 'react', '^19.0.2', 'package.json', 'devDependencies'),
  ]);
});

test('compareWithPublished reports mismatches and unpublished packages, not unused published ones', () => {
  const got = compareWithPublished(
    [decl('A', 'react', '^19.0.1'), decl('A', 'react-dom', '^19.0.2'), decl('A', 'motion', '^12')],
    { react: '^19.0.1', 'react-dom': '^19.0.1', 'lucide-react': '^0.546.0' },
  );
  assert.deepEqual(got.map((d) => [d.dep, d.kind, d.published]), [
    ['react-dom', 'mismatch', '^19.0.1'],
    ['motion', 'unpublished', undefined],
  ]);
});

test('compareWithPublished does not treat an inherited property as published', () => {
  const got = compareWithPublished([decl('A', 'constructor', '^1')], {});
  assert.equal(got[0].kind, 'unpublished');
});

test('unknownEntries names published packages the checker does not align', () => {
  assert.deepEqual(unknownEntries({ react: '^19', 'left-pad': '^1' }, ALIGNED), ['left-pad']);
});

test('canonicalFrom returns the agreed set in ALIGNED_DEPS order', () => {
  const { dependencies, conflicts } = canonicalFrom(
    [decl('B', 'motion', '^12'), decl('A', 'react', '^19'), decl('B', 'react', '^19')],
    ALIGNED,
  );
  assert.deepEqual(Object.entries(dependencies), [['react', '^19'], ['motion', '^12']]);
  assert.deepEqual(conflicts, []);
});

test('canonicalFrom reports a split instead of choosing a side', () => {
  const { dependencies, conflicts } = canonicalFrom([decl('A', 'react', '^19'), decl('B', 'react', '^18')], ALIGNED);
  assert.deepEqual(dependencies, {});
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0][0], 'react');
  assert.deepEqual([...conflicts[0][1].keys()], ['^19', '^18']);
});
