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
  assert.match(runChecker(one), /scope: HarborSentinel only \(compared against the published fleet files; app-to-app comparison skipped\)/);

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
  The dev server's fs allow list. Theme fonts are served from sentinel-shared by
  URL, and outside server.fs.allow Vite answers 403 -- in dev only, and silently.
*/
const appWithAllow = (dir, config, allow) => ({
  [`${dir}/package.json`]: JSON.stringify({
    name: 'x', version: '2.11.1', dependencies: { '@sentinel/theme': 'file:../sentinel-shared/theme' },
  }),
  [`${dir}/${config}`]: `import path from 'path';
export default { server: { fs: { allow: [${allow}] } } };`,
});
const themePackage = sharedPackage('theme', '@sentinel/theme', 'export const a = 1;\n');

test('an app whose fs allow list omits sentinel-shared fails', () => {
  const root = fixture({ ...themePackage, ...appWithAllow('HarborSentinel', 'vite.config.ts', "'.', './shared'") });
  assert.match(runChecker(root), /HarborSentinel: vite\.config\.ts server\.fs\.allow does not include/);
});

test('an app with no fs allow list at all fails', () => {
  const root = fixture({
    ...themePackage,
    'VesselKeeper/package.json': JSON.stringify({
      name: 'x', version: '2.11.1', dependencies: { '@sentinel/theme': 'file:../sentinel-shared/theme' },
    }),
    'VesselKeeper/vite.config.ts': "export default { server: { port: 5173 } };",
  });
  assert.match(runChecker(root), /VesselKeeper: vite\.config\.ts server\.fs\.allow does not include/);
});

test('a path.resolve entry reaching the sibling passes', () => {
  const root = fixture({
    ...themePackage,
    ...appWithAllow('HarborSentinel', 'vite.config.ts', "'.', path.resolve(__dirname, '../sentinel-shared')"),
  });
  assert.doesNotMatch(runChecker(root), /server\.fs\.allow/);
});

test('an entry at the wrong depth is caught, not passed on its name', () => {
  // OceanSentinel's config is in frontend/, so '../sentinel-shared' lands inside OceanSentinel.
  const wrong = fixture({
    ...themePackage,
    ...appWithAllow('OceanSentinel', 'frontend/vite.config.js', "'..', path.resolve(__dirname, '../sentinel-shared')"),
  });
  assert.match(runChecker(wrong), /OceanSentinel: frontend\/vite\.config\.js server\.fs\.allow does not include/);
  const right = fixture({
    ...themePackage,
    ...appWithAllow('OceanSentinel', 'frontend/vite.config.js', "'..', path.resolve(__dirname, '../../sentinel-shared')"),
  });
  assert.doesNotMatch(runChecker(right), /server\.fs\.allow/);
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

/*
  Section 5b. The three app repositories are private, so an anonymous request
  for their GitHub releases 404s -- which each backend's /app-version route
  reported as "No releases published on GitHub yet" while a release existed.
*/
const RELEASES_CALL = "const r = await fetch('https://api.github.com/repos/craigallardyce-cpu/HarborSentinel/releases/latest');\n";
const harbor = (files) => ({
  'HarborSentinel/package.json': JSON.stringify({ name: 'harbor-sentinel', version: '2.11.1' }),
  ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`HarborSentinel/${k}`, v])),
});

test('an anonymous release check in app source fails, naming the file and line', () => {
  const root = fixture(harbor({ 'server/routes/meta.ts': `// meta\n${RELEASES_CALL}` }));
  assert.match(runChecker(root),
    /\[source\] HarborSentinel: server\/routes\/meta\.ts:2 — anonymous release check against a private repo; use @sentinel\/update-feed/);
});

test('release tooling under scripts/ and build output under dist*/ are not scanned', () => {
  const root = fixture(harbor({
    'scripts/supersede-releases.mjs': RELEASES_CALL,
    'backend/scripts/publish.js': RELEASES_CALL,
    'dist-server/server.cjs': RELEASES_CALL,
    'dist/assets/index.js': RELEASES_CALL,
  }));
  assert.doesNotMatch(runChecker(root), /anonymous release check/);
});

test('a release call in documentation is not app source', () => {
  const root = fixture(harbor({ 'docs/updates.md': RELEASES_CALL }));
  assert.doesNotMatch(runChecker(root), /anonymous release check/);
});

test('in a git checkout only tracked files are scanned', () => {
  const root = fixture(harbor({ 'server/tracked.ts': RELEASES_CALL, 'server/scratch.ts': RELEASES_CALL }));
  const appDir = path.join(root, 'HarborSentinel');
  const g = (...args) => execFileSync('git', args, { cwd: appDir, stdio: 'ignore' });
  g('init', '-q');
  g('add', 'package.json', 'server/tracked.ts');
  const out = runChecker(root);
  assert.match(out, /server\/tracked\.ts:1 — anonymous release check/);
  assert.doesNotMatch(out, /server\/scratch\.ts/);
});

/*
  Dependency alignment. It compared the apps with each other only, so like
  version alignment it never ran in an app's CI, where one app is checked out.
  It now compares each app against fleet-dependencies.json. The single-app cases
  are the ones that matter: that is the scope that was blind.
*/
function runWith(root, args = []) {
  try {
    const out = execFileSync('node', [path.join(root, 'sentinel-shared', 'scripts', 'check-fleet-drift.mjs'), ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const FLEET_DEPS = { react: '^19.0.1', 'react-dom': '^19.0.1', '@capacitor/core': '^8.4.1' };
const fleetDeps = (dependencies) => ({
  'sentinel-shared/fleet-dependencies.json': JSON.stringify({ dependencies }),
});
const appWith = (name, file, deps, devDeps) => ({
  [`${name}/${file}`]: JSON.stringify({
    name: name.toLowerCase(), version: '2.11.1', dependencies: deps, ...(devDeps ? { devDependencies: devDeps } : {}),
  }),
});
const fullFleet = (overrides = {}) => ({
  ...appWith('HarborSentinel', 'package.json', FLEET_DEPS),
  ...appWith('VesselKeeper', 'package.json', FLEET_DEPS),
  'OceanSentinel/package.json': JSON.stringify({ name: 'ocean-sentinel', version: '2.11.1' }),
  ...appWith('OceanSentinel', 'frontend/package.json', FLEET_DEPS),
  ...overrides,
});

test('with one app present, a range differing from the published one fails and says how to fix it', () => {
  const root = fixture({
    ...fleetDeps(FLEET_DEPS),
    ...appWith('HarborSentinel', 'package.json', { ...FLEET_DEPS, react: '^19.0.2' }),
  });
  const out = runChecker(root);
  assert.match(out, /HarborSentinel only/);
  assert.match(out, /FAIL {2}\[deps\] HarborSentinel: package\.json dependencies declares react \^19\.0\.2, but sentinel-shared\/fleet-dependencies\.json publishes \^19\.0\.1/);
  assert.match(out, /set it back to \^19\.0\.1 in this app/);
  assert.match(out, /--write-fleet-dependencies/);
  assert.doesNotMatch(out, /react-dom/, 'only the package that differs is named');
});

test('with one app present, matching ranges are not reported, and an unused published package is fine', () => {
  const root = fixture({
    ...fleetDeps({ ...FLEET_DEPS, motion: '^12.23.24' }),
    ...appWith('HarborSentinel', 'package.json', FLEET_DEPS),
  });
  assert.doesNotMatch(runChecker(root), /\[deps\]/);
});

test('a nested package root and devDependencies are each compared', () => {
  const root = fixture({
    ...fleetDeps(FLEET_DEPS),
    'OceanSentinel/package.json': JSON.stringify({ name: 'ocean-sentinel', version: '2.11.1' }),
    ...appWith('OceanSentinel', 'frontend/package.json', FLEET_DEPS, { '@capacitor/core': '^8.5.0' }),
  });
  assert.match(runChecker(root),
    /OceanSentinel: frontend\/package\.json devDependencies declares @capacitor\/core \^8\.5\.0, but .* publishes \^8\.4\.1/);
});

test('an aligned package with no published range fails', () => {
  const root = fixture({
    ...fleetDeps({ react: '^19.0.1' }),
    ...appWith('HarborSentinel', 'package.json', { react: '^19.0.1', tailwindcss: '^4.3.0' }),
  });
  assert.match(runChecker(root), /declares tailwindcss \^4\.3\.0, but sentinel-shared\/fleet-dependencies\.json publishes no range for it/);
});

test('a missing fleet-dependencies.json fails rather than turning the rule off', () => {
  const root = fixture(appWith('HarborSentinel', 'package.json', FLEET_DEPS));
  assert.match(runChecker(root), /FAIL {2}\[deps\] sentinel-shared\/fleet-dependencies\.json is missing/);
});

test('a published package outside ALIGNED_DEPS fails in any scope', () => {
  const root = fixture({
    ...fleetDeps({ ...FLEET_DEPS, 'left-pad': '^1.0.0' }),
    ...appWith('HarborSentinel', 'package.json', FLEET_DEPS),
  });
  assert.match(runChecker(root), /publishes left-pad, which is not in the checker's ALIGNED_DEPS/);
});

test('with the full fleet, a current file and agreeing apps report nothing', () => {
  const root = fixture({ ...fleetDeps(FLEET_DEPS), ...fullFleet() });
  const out = runChecker(root);
  assert.match(out, /scope: full fleet/);
  assert.doesNotMatch(out, /\[deps\]/);
});

test('with the full fleet, a published entry no app declares is flagged as stale', () => {
  const root = fixture({ ...fleetDeps({ ...FLEET_DEPS, motion: '^12.23.24' }), ...fullFleet() });
  assert.match(runChecker(root), /publishes motion \^12\.23\.24, but no app declares it any more/);
});

test('with the full fleet, a file the apps have all moved past is flagged in every app', () => {
  const moved = { ...FLEET_DEPS, react: '^19.1.0' };
  const root = fixture({
    ...fleetDeps(FLEET_DEPS),
    ...fullFleet({
      ...appWith('HarborSentinel', 'package.json', moved),
      ...appWith('VesselKeeper', 'package.json', moved),
      ...appWith('OceanSentinel', 'frontend/package.json', moved),
    }),
  });
  const out = runChecker(root);
  for (const app of ['HarborSentinel', 'VesselKeeper', 'OceanSentinel']) {
    assert.match(out, new RegExp(`${app}: .*declares react \\^19\\.1\\.0, but .* publishes \\^19\\.0\\.1`));
  }
  assert.doesNotMatch(out, /react versions differ/, 'the apps agree with each other');
});

test('with the full fleet, apps split from each other are still named side by side', () => {
  const root = fixture({
    ...fleetDeps(FLEET_DEPS),
    ...fullFleet(appWith('VesselKeeper', 'package.json', { ...FLEET_DEPS, react: '^18.3.1' })),
  });
  assert.match(runChecker(root), /react versions differ: \^19\.0\.1 \(OceanSentinel, HarborSentinel\) {2}vs {2}\^18\.3\.1 \(VesselKeeper\)/);
});

test('--write-fleet-dependencies regenerates the file from an agreeing fleet', () => {
  const root = fixture({ ...fleetDeps({ react: '^18.0.0' }), ...fullFleet() });
  const { status } = runWith(root, ['--write-fleet-dependencies']);
  assert.equal(status, 0);
  const written = JSON.parse(fs.readFileSync(path.join(root, 'sentinel-shared', 'fleet-dependencies.json'), 'utf8'));
  assert.deepEqual(written.dependencies, FLEET_DEPS);
  assert.deepEqual(Object.keys(written.dependencies), ['react', 'react-dom', '@capacitor/core'],
    'written in ALIGNED_DEPS order, so a regeneration diffs only what changed');
  assert.doesNotMatch(runChecker(root), /\[deps\]/);
});

test('--write-fleet-dependencies refuses while the apps disagree, and leaves the file alone', () => {
  const root = fixture({
    ...fleetDeps(FLEET_DEPS),
    ...fullFleet(appWith('VesselKeeper', 'package.json', { ...FLEET_DEPS, react: '^18.3.1' })),
  });
  const { status, out } = runWith(root, ['--write-fleet-dependencies']);
  assert.equal(status, 1);
  assert.match(out, /the apps disagree/);
  assert.match(out, /react: \^19\.0\.1 \(OceanSentinel\/frontend\/package\.json, HarborSentinel\/package\.json\) {2}vs {2}\^18\.3\.1 \(VesselKeeper\/package\.json\)/);
  const kept = JSON.parse(fs.readFileSync(path.join(root, 'sentinel-shared', 'fleet-dependencies.json'), 'utf8'));
  assert.deepEqual(kept.dependencies, FLEET_DEPS);
});

test('--write-fleet-dependencies refuses without the full fleet', () => {
  const root = fixture(appWith('HarborSentinel', 'package.json', FLEET_DEPS));
  const { status, out } = runWith(root, ['--write-fleet-dependencies']);
  assert.equal(status, 1);
  assert.match(out, /needs all of them/);
  assert.equal(fs.existsSync(path.join(root, 'sentinel-shared', 'fleet-dependencies.json')), false);
});
