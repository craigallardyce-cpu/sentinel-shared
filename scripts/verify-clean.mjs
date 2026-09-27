#!/usr/bin/env node
/**
 * Run a fleet repo's checks against a clean checkout, the way CI would.
 *
 *   node sentinel-shared/scripts/verify-clean.mjs <repo-dir> [--ref <git-ref>] [--shared-ref <git-ref>] [--keep] [--out <dir>]
 *
 * Why this exists: from October 2026 the private repos' `test.yml` runs only on
 * `workflow_dispatch`, to keep the account inside its Actions minutes (September
 * spent the whole allowance by the 26th). The checks did not go away; they moved
 * here. Each repo lists them once, as `npm run verify` in its package.json, and
 * its `test.yml` calls that same script, so the local run and a CI run cannot
 * drift apart.
 *
 * What it does, in order:
 *   1. `git archive` the repo at --ref (default HEAD) into a scratch directory,
 *      and this repository at --shared-ref (default HEAD) beside it as
 *      `sentinel-shared`. Tracked files only: an untracked file in a working tree
 *      is exactly what masked both release failures in this fleet's history.
 *      Only those two, because that is what CI checks out, so the drift checker
 *      runs at the same per-app scope CI gives it.
 *   2. Install: `npm run verify:install` if the repo defines it, else `npm ci`.
 *   3. `npm run verify`.
 *   4. Print the two SHAs and each step's result, for the PR's "Verified" section.
 *
 * Exit code: 0 only if every step passed. The scratch directory is removed
 * unless --keep is given. Works on Windows (cmd, PowerShell) and POSIX: it uses
 * `git archive -o` and `tar -xf` rather than a pipe, and runs npm through the shell.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse argv into options. Pure; exported for tests. */
export function parseArgs(argv) {
  const opts = { repo: null, ref: 'HEAD', sharedRef: 'HEAD', keep: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') opts.ref = argv[++i];
    else if (a === '--shared-ref') opts.sharedRef = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else if (!opts.repo) opts.repo = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  for (const k of ['ref', 'sharedRef', 'out']) {
    if (opts[k] === undefined) throw new Error(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} needs a value`);
  }
  return opts;
}

/** Which install command a package.json asks for. Pure; exported for tests. */
export function installCommand(pkg) {
  return pkg?.scripts?.['verify:install'] ? 'npm run verify:install' : 'npm ci';
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function extract(repoDir, ref, dest, scratch, mustExist = 'package.json') {
  mkdirSync(dest, { recursive: true });
  const tarFile = join(scratch, `${basename(dest)}.tar`);
  git(repoDir, ['archive', '--format=tar', '-o', tarFile, ref]);
  const r = spawnSync('tar', ['-xf', tarFile, '-C', dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar -xf ${tarFile} failed: ${r.stderr.trim()}`);
  rmSync(tarFile, { force: true });
  if (!existsSync(join(dest, mustExist))) {
    throw new Error(`Extraction of ${repoDir}@${ref} produced no ${mustExist} in ${dest}`);
  }
}

function run(label, command, cwd) {
  console.log(`\n=== ${label}: ${command}`);
  const started = Date.now();
  const r = spawnSync(command, { cwd, shell: true, stdio: 'inherit' });
  const seconds = Math.round((Date.now() - started) / 1000);
  return { label, command, status: r.status ?? 1, seconds };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help || !opts.repo) {
    console.log('Usage: node sentinel-shared/scripts/verify-clean.mjs <repo-dir> [--ref <ref>] [--shared-ref <ref>] [--keep] [--out <dir>]');
    process.exit(opts.help ? 0 : 2);
  }

  const repoDir = resolve(opts.repo);
  const repoName = basename(repoDir);
  const repoSha = git(repoDir, ['rev-parse', opts.ref]);
  const sharedSha = git(SHARED_DIR, ['rev-parse', opts.sharedRef]);

  const scratch = opts.out ? resolve(opts.out) : mkdtempSync(join(tmpdir(), 'verify-clean-'));
  mkdirSync(scratch, { recursive: true });
  const appDir = join(scratch, repoName);
  const sharedDir = join(scratch, 'sentinel-shared');

  const npmVersion = spawnSync('npm', ['-v'], { encoding: 'utf8', shell: true }).stdout?.trim() ?? '';
  if (!npmVersion.startsWith('11.')) {
    console.warn(`WARN npm ${npmVersion || '(not found)'} -- CI and the fleet use npm 11, and the two can write lockfiles differently.`);
  }

  const results = [];
  let failed = false;
  try {
    extract(repoDir, opts.ref, appDir, scratch);
    if (repoName !== 'sentinel-shared') extract(SHARED_DIR, opts.sharedRef, sharedDir, scratch, 'scripts/check-fleet-drift.mjs');

    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    if (!pkg.scripts?.verify) throw new Error(`${repoName}@${opts.ref} has no "verify" script in package.json`);

    for (const [label, command] of [['install', installCommand(pkg)], ['verify', 'npm run verify']]) {
      const r = run(label, command, appDir);
      results.push(r);
      if (r.status !== 0) { failed = true; break; }
    }
  } catch (err) {
    console.error(`\nERROR ${err.message}`);
    failed = true;
  } finally {
    console.log('\n=== verify-clean summary');
    console.log(`repo           ${repoName} @ ${repoSha.slice(0, 7)} (${opts.ref})`);
    console.log(`sentinel-shared  @ ${sharedSha.slice(0, 7)} (${opts.sharedRef})`);
    console.log(`npm            ${npmVersion}`);
    for (const r of results) console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${r.label.padEnd(8)} ${r.command}  (${r.seconds}s)`);
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
    if (opts.keep) console.log(`kept: ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
