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
  assert.match(runChecker(one), /scope: HarborSentinel only \(cross-app checks skipped\)/);

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
