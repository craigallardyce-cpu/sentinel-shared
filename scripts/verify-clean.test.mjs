import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, installCommand } from './verify-clean.mjs';

test('parseArgs defaults to HEAD for both refs', () => {
  assert.deepEqual(parseArgs(['../HarborSentinel']), {
    repo: '../HarborSentinel', ref: 'HEAD', sharedRef: 'HEAD', keep: false, out: null
  });
});

test('parseArgs reads every option', () => {
  const o = parseArgs(['OceanSentinel', '--ref', 'origin/fix/x', '--shared-ref', 'abc123', '--keep', '--out', '/tmp/v']);
  assert.equal(o.repo, 'OceanSentinel');
  assert.equal(o.ref, 'origin/fix/x');
  assert.equal(o.sharedRef, 'abc123');
  assert.equal(o.keep, true);
  assert.equal(o.out, '/tmp/v');
});

test('parseArgs rejects an unknown option, a stray argument and a missing value', () => {
  assert.throws(() => parseArgs(['X', '--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['X', 'Y']), /Unexpected argument/);
  assert.throws(() => parseArgs(['X', '--ref']), /--ref needs a value/);
});

test('installCommand prefers verify:install and falls back to npm ci', () => {
  assert.equal(installCommand({ scripts: { 'verify:install': 'npm install --legacy-peer-deps' } }), 'npm run verify:install');
  assert.equal(installCommand({ scripts: { verify: 'x' } }), 'npm ci');
  assert.equal(installCommand({}), 'npm ci');
});
