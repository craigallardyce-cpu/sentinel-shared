/**
 * End-to-end tests for the drift checker itself.
 *
 * The checker gates all three apps' CI and had no test of any kind, so its own
 * defects were only ever found by a person noticing that a count "did not move
 * as far as expected" -- three times in one afternoon on 2026-09-07. Unit tests
 * on the matching helpers (scripts/lib/*.test.mjs) catch the logic; these run
 * the real script against a fixture fleet, which is the only way to catch a
 * rule that is correct in isolation and wired up wrongly.
 *
 * The fixture is a throwaway Projects/ directory: a copy of scripts/ under
 * sentinel-shared/, plus whichever app directories a case needs. `scripts/` is
 * copied rather than symlinked because the checker derives the fleet root from
 * its own module path, and Node resolves a symlink back to its real location --
 * which would silently point the run at the real fleet instead of the fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** A fixture fleet root containing a copy of the checker and the given files. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-drift-'));
  fs.cpSync(SCRIPTS_DIR, path.join(root, 'sentinel-shared', 'scripts'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  return root;
}

/**
 * Run the checker in a fixture and return its output. A non-zero exit is
 * expected and not interesting here -- a bare fixture app trips several
 * unrelated rules -- so the status is ignored and the report is what is read.
 */
function runChecker(root) {
  try {
    return execFileSync('node', [path.join(root, 'sentinel-shared', 'scripts', 'check-fleet-drift.mjs')], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

const PIN = 'f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90';

const buildYml = (withBlock) => `name: Build
on: [workflow_dispatch]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Check out sentinel-shared
        uses: actions/checkout@v5
        with:
${withBlock}
`;

const app = (withBlock) => ({
  'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
  'HarborSentinel/.github/workflows/build.yml': buildYml(withBlock),
});

/*
  The regression. Before scripts/lib/yaml-scan.mjs the pin rule matched `ref:`
  only within 400 characters of `repository:`, so this workflow -- pinned, and
  pinned correctly -- was reported as having no pin at all. The comment below is
  the kind that caused it: an explanation of why the pin exists.
*/
test('a pinned workflow with a long comment above ref is read as pinned', () => {
  const root = fixture(app(`          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
          # Pinned deliberately: a release must build against the shared code it was
          # tested with, rather than whatever main happens to be when the tag is cut.
          # Bump this in all three apps together whenever a shared package changes,
          # and only ever to a commit published on origin/main -- a pin that exists
          # only locally produces no build at all, in all three apps at once.
          ref: ${PIN}
`));
  const out = runChecker(root);

  assert.doesNotMatch(out, /is not pinned to a SHA/,
    'the pin was found, so the rule must not report the checkout as unpinned');
  assert.match(out, new RegExp(PIN.slice(0, 7)),
    'the rule should name the pin it found');
});

test('a workflow with no ref is reported as unpinned', () => {
  const root = fixture(app(`          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
`));
  assert.match(runChecker(root), /HarborSentinel: shared checkout is not pinned to a SHA/);
});

/*
  Pinned to a branch is a different mistake from not pinned at all, and used to
  report as the same one because the old pattern matched only hex.
*/
test('a branch ref is reported as its own mistake, not as a missing pin', () => {
  const root = fixture(app(`          repository: craigallardyce-cpu/sentinel-shared
          ref: main
`));
  const out = runChecker(root);
  assert.match(out, /pinned to 'main' rather than a SHA/);
  assert.doesNotMatch(out, /is not pinned to a SHA/);
});

test('a ref that appears only in a comment does not count as a pin', () => {
  const root = fixture(app(`          repository: craigallardyce-cpu/sentinel-shared
          # ref: ${PIN} was the pin before the 2.11.0 bump
`));
  assert.match(runChecker(root), /HarborSentinel: shared checkout is not pinned to a SHA/);
});

/*
  Scope is resolved from the sibling directories, never from the working
  directory -- the property CLAUDE.md described wrongly until 2026-09-08.
*/
test('scope is reported from the apps present beside sentinel-shared', () => {
  const one = fixture(app(`          repository: craigallardyce-cpu/sentinel-shared
          ref: ${PIN}
`));
  assert.match(runChecker(one), /scope: HarborSentinel only \(cross-app dependency alignment skipped\)/);

  const two = fixture({
    ...app(`          repository: craigallardyce-cpu/sentinel-shared
          ref: ${PIN}
`),
    'VesselKeeper/package.json': JSON.stringify({ name: 'vessel-keeper', version: '2.11.1' }),
  });
  assert.match(runChecker(two), /scope: full fleet/);
});

/*
  The alias rule is the one guarding the documented clean-checkout failure: a
  shared package gains a bare runtime import, and every app whose Vite config
  has no alias for it fails to build. It looked packages up by `@sentinel/` plus
  the directory name, which is right for every package but `charts/`, published
  as `@mariner-sentinel/charts`. That package was therefore skipped twice over
  -- once by the lookup key, once by the prefix test on the app's dependencies
  -- and skipped silently, which is the only way this rule can be wrong and
  still look healthy.
*/
const sharedPackage = (dir, name, distSource) => ({
  [`sentinel-shared/${dir}/package.json`]: JSON.stringify({ name, version: '1.0.3' }),
  [`sentinel-shared/${dir}/dist/index.js`]: distSource,
});

const appDependingOn = (dep, aliases) => ({
  'HarborSentinel/package.json': JSON.stringify({
    name: 'harbor-sentinel', version: '2.11.1', dependencies: { [dep]: 'file:../sentinel-shared/charts' },
  }),
  'HarborSentinel/vite.config.ts': `import path from 'path';
export default { resolve: { alias: {
${aliases.map((a) => `  '${a}': path.resolve(__dirname, '../sentinel-shared/x'),`).join('\n')}
} } };`,
});

test('a package whose directory name is not its package name is still alias-checked', () => {
  const root = fixture({
    ...sharedPackage('charts', '@mariner-sentinel/charts', "import { z } from 'zod';\nexport const a = z;\n"),
    ...appDependingOn('@mariner-sentinel/charts', ['@mariner-sentinel/charts']),
  });
  const out = runChecker(root);
  assert.match(out, /@mariner-sentinel\/charts imports "zod".*no alias for it/,
    'the unaliased import must be reported against the real package name');
});

test('an aliased bare import in that same package passes', () => {
  const root = fixture({
    ...sharedPackage('charts', '@mariner-sentinel/charts', "import { z } from 'zod';\nexport const a = z;\n"),
    ...appDependingOn('@mariner-sentinel/charts', ['@mariner-sentinel/charts', 'zod']),
  });
  assert.doesNotMatch(runChecker(root), /no alias for it/);
});

/*
  The lockfile check had the same name-prefix defect as the alias rule: it only
  considered entries named `@sentinel/…`, so a `@mariner-sentinel/charts` whose
  recorded version had drifted from the one on disk was passed over in silence.
  A stale lockfile entry is the documented duplicate-instance class, so silence
  is the expensive answer here.
*/
const lockfileFor = (name, version) => JSON.stringify({
  name: 'harbor-sentinel',
  lockfileVersion: 3,
  packages: { '../sentinel-shared/charts': { name, version } },
});

test('a drifted version is caught for a package outside the @sentinel scope', () => {
  const root = fixture({
    ...sharedPackage('charts', '@mariner-sentinel/charts', 'export const a = 1;\n'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
    // sharedPackage writes version 1.0.3; the lockfile disagrees.
    'HarborSentinel/package-lock.json': lockfileFor('@mariner-sentinel/charts', '1.0.2'),
  });
  assert.match(runChecker(root),
    /records @mariner-sentinel\/charts 1\.0\.2, but sentinel-shared has 1\.0\.3/);
});

test('a matching version for that package is not reported', () => {
  const root = fixture({
    ...sharedPackage('charts', '@mariner-sentinel/charts', 'export const a = 1;\n'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
    'HarborSentinel/package-lock.json': lockfileFor('@mariner-sentinel/charts', '1.0.3'),
  });
  assert.doesNotMatch(runChecker(root), /@mariner-sentinel\/charts/);
});

/*
  Version alignment used to compare the apps with each other, which put it
  behind the `presentApps.length > 1` gate and so it never ran in any app's CI,
  where exactly one app is ever checked out. These cases all use a single app
  on purpose: an app count of one is the scope that was blind, and a rule that
  only fires with three checkouts present would pass a test written any other
  way while still never running where it matters.
*/
const fleetVersion = (version) => ({
  'sentinel-shared/fleet-version.json': JSON.stringify({ version }),
});

test('an app out of step with the published fleet version fails with one app present', () => {
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.0' }),
  });
  const out = runChecker(root);
  assert.match(out, /HarborSentinel only/);
  assert.match(out, /root package\.json is 2\.11\.0, but the fleet version published in/);
});

test('an app matching the published fleet version is not reported', () => {
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
  });
  assert.doesNotMatch(runChecker(root), /fleet version published/);
});

test('a missing fleet-version.json warns rather than passing in silence', () => {
  const root = fixture({
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
  });
  assert.match(runChecker(root), /fleet-version\.json is missing/);
});

/*
  The lockfile's own version fields. npm writes the package's version into two
  places and nothing reads either, so a bump that skips `npm install` leaves
  both stale through a green build -- which is what all three apps did between
  2.11.0 and 2.11.1.
*/
const selfLock = (version, { packagesEntry = true } = {}) => JSON.stringify({
  name: 'harbor-sentinel',
  version,
  lockfileVersion: 3,
  packages: packagesEntry ? { '': { name: 'harbor-sentinel', version } } : {},
});

test('a lockfile recording a stale version of its own package fails', () => {
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
    'HarborSentinel/package-lock.json': selfLock('2.11.0'),
  });
  const out = runChecker(root);
  assert.match(out, /package-lock\.json records top-level "version" 2\.11\.0 and packages\[""\]\.version 2\.11\.0, but package\.json is 2\.11\.1/);
});

test('only the field that is actually stale is named', () => {
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
    'HarborSentinel/package-lock.json': JSON.stringify({
      name: 'harbor-sentinel', version: '2.11.1', lockfileVersion: 3,
      packages: { '': { name: 'harbor-sentinel', version: '2.11.0' } },
    }),
  });
  const out = runChecker(root);
  assert.match(out, /records packages\[""\]\.version 2\.11\.0, but package\.json is 2\.11\.1/);
  assert.doesNotMatch(out, /top-level "version"/);
});

test('a lockfile recording its own version correctly is not reported', () => {
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
    'HarborSentinel/package-lock.json': selfLock('2.11.1'),
  });
  assert.doesNotMatch(runChecker(root), /but package\.json is/);
});

test("a nested package root is compared with its own package.json, not the fleet's", () => {
  // OceanSentinel's frontend/ is 0.0.0 and backend/ 1.0.0 by design; neither is
  // the fleet version, and aligning them to it would be the wrong fix.
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'OceanSentinel/package.json': JSON.stringify({ name: 'oceansentinel', version: '2.11.1' }),
    'OceanSentinel/package-lock.json': selfLock('2.11.1'),
    'OceanSentinel/frontend/package.json': JSON.stringify({ name: 'frontend', version: '0.0.0' }),
    'OceanSentinel/frontend/package-lock.json': JSON.stringify({
      name: 'frontend', version: '0.0.0', lockfileVersion: 3,
      packages: { '': { name: 'frontend', version: '0.0.0' } },
    }),
  });
  const out = runChecker(root);
  assert.doesNotMatch(out, /but package\.json is/);
  assert.doesNotMatch(out, /frontend\/package-lock\.json records/);
});

test('a stale nested lockfile is named by its own path', () => {
  const root = fixture({
    ...fleetVersion('2.11.1'),
    'OceanSentinel/package.json': JSON.stringify({ name: 'oceansentinel', version: '2.11.1' }),
    'OceanSentinel/frontend/package.json': JSON.stringify({ name: 'frontend', version: '0.1.0' }),
    'OceanSentinel/frontend/package-lock.json': JSON.stringify({
      name: 'frontend', version: '0.0.0', lockfileVersion: 3,
      packages: { '': { name: 'frontend', version: '0.0.0' } },
    }),
  });
  assert.match(runChecker(root),
    /frontend\/package-lock\.json records .*but frontend\/package\.json is 0\.1\.0/);
});
