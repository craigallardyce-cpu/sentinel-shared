/**
 * Tests for smoke-launch-linux.sh, the headless launch check the three apps'
 * build.yml run against their built AppImage.
 *
 * These cover the ways it must FAIL, and that it leaves nothing running, with
 * stand-in "AppImages" that are shell scripts. The passing path needs a real
 * Electron app and was verified against the v2.11.4 AppImages of all three
 * apps (see the PR that added this file); it is exercised for real on every
 * app build that runs the step.
 *
 * Needs bash, xvfb-run and xdotool, so it skips on Windows and on a machine
 * without them -- which includes this repo's own CI unless those are
 * installed there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'smoke-launch-linux.sh');

function have(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

const skip =
  process.platform === 'win32'
    ? 'bash here may be WSL or Git Bash; run on Linux'
    : !have('xvfb-run') || !have('xdotool')
      ? 'needs xvfb-run and xdotool (apt-get install xvfb xdotool)'
      : false;

/** A stand-in AppImage: an executable shell script with the given body. */
function fakeApp(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fake-'));
  const file = path.join(dir, 'Fake.AppImage');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

function run(args, env = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SMOKE_SETTLE: '1', ...env },
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('usage error without arguments exits 2', { skip }, () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.out, /window-regex/);
});

test('a missing AppImage is a usage error, not a smoke failure', { skip }, () => {
  const r = run(['/nonexistent/App.AppImage', 'App']);
  assert.equal(r.status, 2);
  assert.match(r.out, /no such file/);
});

test('a directory must hold exactly one AppImage', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-dir-'));
  let r = run([dir, 'App']);
  assert.equal(r.status, 2);
  assert.match(r.out, /expected exactly one \*\.AppImage .* found 0/);
  fs.writeFileSync(path.join(dir, 'A.AppImage'), '');
  fs.writeFileSync(path.join(dir, 'B.AppImage'), '');
  r = run([dir, 'App']);
  assert.equal(r.status, 2);
  assert.match(r.out, /found 2/);
});

test('an app that exits before any window fails with its status and output', { skip }, () => {
  const app = fakeApp('echo "Supabase configuration missing" >&2\nexit 3');
  const r = run([app, 'Fake'], { SMOKE_TIMEOUT: '20' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /exited .* before any window .*exit status 3/);
  assert.match(r.out, /Supabase configuration missing/, 'app output tail is printed');
});

test('an app that stays up with no window fails at the timeout', { skip }, () => {
  const app = fakeApp('echo started; exec sleep 300');
  const r = run([app, 'Fake'], { SMOKE_TIMEOUT: '3' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /no window matching \/Fake\/ within 3s/);
  assert.match(r.out, /started/);
});

test('the app and every descendant are killed afterwards, even one that left the group', { skip }, () => {
  const marker = `smoke-test-${process.pid}-${Date.now()}`;
  // A child in the app's group, and a grandchild that setsid()s itself out of
  // it -- the second is what the pid-tree walk exists for.
  const app = fakeApp(
    `bash -c 'exec -a ${marker}-child sleep 300' &\n` +
      `setsid bash -c 'exec -a ${marker}-escaped sleep 300' &\n` +
      'exec sleep 300',
  );
  const r = run([app, 'Fake'], { SMOKE_TIMEOUT: '3' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /app process tree stopped/);
  const left = spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' });
  assert.equal(left.stdout.trim(), '', `processes left running: ${left.stdout}`);
});
