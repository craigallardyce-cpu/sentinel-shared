import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, installCommand, resolveCommit, canonicalRepoName, extract } from './verify-clean.mjs';

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

test('resolveCommit returns a held commit and refuses one the clone does not have', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'verify-clean-test-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'a');
    const head = git('rev-parse', 'HEAD');

    assert.equal(resolveCommit(dir, 'HEAD'), head);
    assert.equal(resolveCommit(dir, head), head);
    // A well-formed SHA of a commit this clone never fetched: plain rev-parse
    // echoes it back, which is the bug this guards.
    assert.throws(() => resolveCommit(dir, 'd15ee0feaa38ae6d3b6c72aa5f172518a07a188e'), /is not a commit .* Fetch it first/);
    assert.throws(() => resolveCommit(dir, 'no-such-branch'), /is not a commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function tempRepo() {
  const { mkdtempSync, writeFileSync, mkdirSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'verify-clean-test-')));
  const dir = join(root, 'MainRepo');
  mkdirSync(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(dir, 'package.json'), '{}');
  git('add', 'package.json');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'a');
  return { root, dir, git };
}

test('canonicalRepoName names a repo and its worktrees after the main checkout', async () => {
  const { rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { root, dir, git } = await tempRepo();
  try {
    const wt = join(root, 'MainRepo-wt-other');
    git('worktree', 'add', '-q', wt, '-b', 'other');
    assert.equal(canonicalRepoName(dir), 'MainRepo');
    assert.equal(canonicalRepoName(wt), 'MainRepo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('extract unpacks a git archive into dest via a relative tar path', async () => {
  const { rmSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { root, dir } = await tempRepo();
  try {
    const dest = join(root, 'scratch', 'MainRepo');
    extract(dir, 'HEAD', dest, join(root, 'scratch'));
    assert.ok(existsSync(join(dest, 'package.json')));
    assert.ok(!existsSync(join(root, 'scratch', 'MainRepo.tar')), 'tar file is cleaned up');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
