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

/*
  Section 12, as fit-and-finish Wave 3 tightened it: the 13px floor and
  VesselKeeper's phone-only 12, status colours on labelled buttons, glows, and
  the deprecated names. Each fixture is one app with one source file, so a
  match names exactly the thing the case planted.
*/
const appSource = (name, file, body) => {
  const srcRoot = name === 'OceanSentinel' ? 'frontend/src' : 'src';
  return {
    [`${name}/package.json`]: JSON.stringify({ name: name.toLowerCase(), version: '2.11.1' }),
    [`${name}/${srcRoot}/${file}`]: body,
  };
};
const checkSource = (name, file, body) => runChecker(fixture(appSource(name, file, body)));

test('the type floor is 13: a text-[12px] in HarborSentinel fails, even with an sm: step beside it', () => {
  const bare = checkSource('HarborSentinel', 'A.tsx', '<span className="text-[12px] text-text-muted">x</span>\n');
  assert.match(bare, /FAIL {2}\[type\] HarborSentinel: 1 type size\(s\) below the 13px floor.*src\/A\.tsx:1 text-\[12px\]/);
  const withSm = checkSource('HarborSentinel', 'A.tsx', '<span className="text-[12px] sm:text-[13px]">x</span>\n');
  assert.match(withSm, /FAIL {2}\[type\] HarborSentinel: 1 type size/, 'the phone-only 12 is VesselKeeper\'s alone');
});

test('text-xs is under the floor, at rest and behind a prefix', () => {
  const out = checkSource('OceanSentinel', 'A.jsx', '<p className="text-xs">a</p>\n<p className="md:text-xs">b</p>\n');
  assert.match(out, /OceanSentinel: 2 type size\(s\) below the 13px floor.*frontend\/src\/A\.jsx:1 text-xs, frontend\/src\/A\.jsx:2 md:text-xs/);
});

test('13px and above pass, and a stylesheet font-size of 12 fails', () => {
  assert.doesNotMatch(checkSource('HarborSentinel', 'A.tsx', '<span className="text-[13px] text-sm">x</span>\n'), /FAIL {2}\[type\]/);
  const css = checkSource('HarborSentinel', 'a.css', '.dense { font-size: 12px; }\n');
  assert.match(css, /HarborSentinel: 1 type size\(s\) below the 13px floor.*font-size: 12px/);
  const exempt = checkSource('HarborSentinel', 'a.css', '/* type-floor-exempt: licence credit */\n.credit { font-size: 9px; }\n');
  assert.doesNotMatch(exempt, /FAIL {2}\[type\]/, 'the exemption comment still works');
});

test('VesselKeeper may draw 12px below sm, written as text-[12px] sm:text-[13px]', () => {
  for (const cls of ['text-[12px] sm:text-[13px] w-full', 'text-xs sm:text-body-sm', 'w-full text-[12px] sm:text-sm']) {
    // The theme's named steps are read from type.css, so the fixture needs it.
    const out = runChecker(fixture({
      ...appSource('VesselKeeper', 'Table.tsx', `<table className="${cls}"><tbody /></table>\n`),
      'sentinel-shared/theme/type.css': fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'theme', 'type.css'), 'utf8'),
    }));
    assert.doesNotMatch(out, /FAIL {2}\[type\]/, cls);
  }
});

test('VesselKeeper still fails a bare 12, a 12 at sm and up, an 11, and a 12 whose sm step is in another string', () => {
  const cases = [
    '<td className="text-[12px] w-full">x</td>',
    '<td className="sm:text-[12px] text-[13px]">x</td>',
    '<td className="text-[11px] sm:text-[13px]">x</td>',
    '<td className="text-[12px] sm:text-[12px]">x</td>',
    '<td className="text-[12px]" data-x="sm:text-[13px]">x</td>',
  ];
  for (const body of cases) {
    assert.match(checkSource('VesselKeeper', 'Table.tsx', `${body}\n`), /FAIL {2}\[type\] VesselKeeper: \d+ type size.*text-\[1[12]px\]/, body);
  }
});

test('a labelled button painted bg-green fails even when its onClick is an arrow function', () => {
  const body = `export const A = () => (
  <button onClick={() => save()} className="px-4 h-12 bg-green text-bg-app">
    Save
  </button>
);
`;
  const out = checkSource('HarborSentinel', 'A.tsx', body);
  assert.match(out, /FAIL {2}\[ui\] HarborSentinel: 1 labelled <button>\(s\) painted a status colour.*src\/A\.tsx:2 bg-green/);
});

test('a status colour behind a prefix fails too, and a label from an expression is a label', () => {
  const body = `<button
  onClick={async () => { if (await ok()) { go(); } }}
  className={\`px-3 \${busy ? 'opacity-50' : ''} hover:bg-red/10\`}
>
  {busy ? 'Clearing' : 'Clear track'}
</button>
`;
  assert.match(checkSource('OceanSentinel', 'A.jsx', body), /OceanSentinel: 1 labelled <button>\(s\).*hover:bg-red/);
});

test('an icon-only status-coloured button is not a labelled button', () => {
  const body = '<button onClick={() => close()} className="hover:bg-red/10" aria-label="Close"><X size={16} /></button>\n';
  assert.doesNotMatch(checkSource('HarborSentinel', 'A.tsx', body), /labelled <button>/);
});

test('an accent button behind an arrow onClick is now seen, and still only warns', () => {
  const body = '<button onClick={() => go()} className="bg-cyan text-bg-app">Go</button>\n';
  const out = checkSource('HarborSentinel', 'A.tsx', body);
  assert.match(out, /WARN {2}\[ui\] HarborSentinel: 1 hand-rolled <button>\(s\) wearing fleet colours/);
  assert.doesNotMatch(out, /FAIL {2}\[ui\]/);
});

test('a zero-offset coloured shadow fails, in a class, a stylesheet, a style object and a marker\'s HTML', () => {
  const cases = [
    ['A.tsx', '<div className="shadow-[0_0_8px_var(--color-cyan)]" />\n'],
    ['A.tsx', '<div className="shadow-[0_0_12px_#22d3ee]" />\n'],
    ['a.css', '.lit { box-shadow: 0 0 6px var(--color-cyan-glow); }\n'],
    ['A.tsx', "<div style={{ boxShadow: '0 0 10px rgba(34,211,238,0.8)' }} />\n"],
    ['A.tsx', 'const html = `<div style="box-shadow:0 0 6px rgba(34,211,238,0.8);"></div>`;\n'],
    ['A.tsx', 'const html = `<span style="box-shadow:0 0 8px color-mix(in srgb, ${ink} 55%, transparent);"></span>`;\n'],
    ['a.css', '.icon { filter: drop-shadow(0 0 4px #4cd7f6); }\n'],
  ];
  for (const [file, body] of cases) {
    assert.match(checkSource('OceanSentinel', file, body), /FAIL {2}\[theme\] OceanSentinel: 1 glow\(s\)/, body);
  }
});

test('a black or --bg-app legibility halo, a ring, an offset shadow and the panel shadow all pass', () => {
  const cases = [
    ['A.tsx', '<div className="shadow-[var(--panel-shadow)] drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]" />\n'],
    ['A.tsx', 'const html = `<div style="filter: drop-shadow(0 0 3px rgba(0,0,0,0.85))"></div>`;\n'],
    ['A.tsx', 'const html = `<div style="filter: drop-shadow(0 0 1px var(--bg-app)) drop-shadow(0 0 1px var(--bg-app))"></div>`;\n'],
    ['A.tsx', "<td style={{ boxShadow: on ? 'inset 0 0 0 1.5px rgba(255,255,255,0.55)' : 'none' }} />\n"],
    ['A.tsx', "<div style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.7)' }} />\n"],
    ['a.css', '.panel { box-shadow: var(--panel-shadow); }\n.flat { box-shadow: none !important; }\n'],
    ['A.tsx', '// box-shadow: 0 0 8px cyan was the old look\nexport const a = 1;\n'],
  ];
  for (const [file, body] of cases) {
    assert.doesNotMatch(checkSource('OceanSentinel', file, body), /glow\(s\)/, body);
  }
});

test('the literal-colour shadow rule no longer advises a glow token', () => {
  const out = checkSource('HarborSentinel', 'A.tsx', '<div className="shadow-[0_2px_4px_#22d3ee]" />\n');
  assert.match(out, /FAIL {2}\[theme\] HarborSentinel: 1 shadow\(s\) carry a literal colour.*State is fill and stroke; no glows/);
  assert.doesNotMatch(out, /Use var\(--color-\*-glow\)/);
});

test('each deprecated name warns, naming its replacement', () => {
  const cases = [
    ['A.tsx', '<span className="text-label-caps text-text-muted">x</span>', /1 use\(s\) of text-label-caps.*use text-label/],
    ['A.tsx', '<div className="rounded-sm border p-2">x</div>', /1 use\(s\) of rounded-sm.*use rounded-md/],
    ['A.tsx', '<div className="rounded border p-2">x</div>', /1 use\(s\) of rounded,.*use rounded-md/],
    ['A.tsx', '<div className="rounded">x</div>', /1 use\(s\) of rounded,.*use rounded-md/],
    ['A.tsx', '<div className="hover:rounded-lg border">x</div>', /1 use\(s\) of rounded-lg.*use rounded-md/],
    ['a.css', '.x { outline: 1px solid var(--color-cyan-glow); }', /1 use\(s\) of var\(--color-\*-glow\).*state is fill and stroke/],
    ['a.css', '.x { border-color: var(--border-color-glass); }', /1 use\(s\) of --border-color-glass.*use var\(--border-color\)/],
    ['A.tsx', '<Button onClick={() => go()} variant="success">Go</Button>', /1 use\(s\) of <Button variant="success">.*use variant="primary"/],
    ['A.tsx', '<Button variant={"accent"} onClick={() => go()}>Go</Button>', /1 use\(s\) of <Button variant="accent">.*use variant="secondary"/],
    ['A.tsx', '<Button size="dense">Go</Button>', /1 use\(s\) of <Button size="dense">.*use size="sm"/],
    ['A.tsx', "const tabs = [{ id: 'log', label: \"Ship's Log\", shortLabel: 'Log' }];", /1 use\(s\) of shortLabel.*soft hyphen/],
    ['A.tsx', '<AppShell dockFooter={<span>v2</span>} />', /1 use\(s\) of dockFooter.*Settings > About/],
  ];
  for (const [file, body, re] of cases) {
    const out = checkSource('VesselKeeper', file, `${body}\n`);
    assert.match(out, new RegExp(`WARN {2}\\[deprecated\\] VesselKeeper: ${re.source}`), body);
    assert.doesNotMatch(out, /FAIL {2}\[deprecated\]/);
  }
});

test('the word "rounded" in prose or code, and a deprecated name in a comment, do not warn', () => {
  const body = `// rounded corners, text-label-caps and rounded-lg were the old look
const rounded = Math.round(x);
const msg = 'Speed is rounded to the nearest knot';
export const A = () => <div className="rounded-md rounded-xl p-2" title="rounded" />;
`;
  assert.doesNotMatch(checkSource('VesselKeeper', 'A.tsx', body), /\[deprecated\]/);
});

/*
  The shared packages' own UI (fit-and-finish fixes, 2026-10-05). The rules
  above read only the apps' source, so ForecastTimeline kept 12px mono capitals
  and AuthScreen three glows through every wave. A shared package whose src/
  renders UI is held to the same floor, glow and status-button rules. Each
  fixture is one clean app plus one shared package file.
*/
const withShared = (files) =>
  runChecker(fixture({
    ...appSource('HarborSentinel', 'A.tsx', 'export const a = 1;\n'),
    ...Object.fromEntries(Object.entries(files).map(([rel, body]) => [`sentinel-shared/${rel}`, body])),
  }));
/** A finding against a shared package, as opposed to the fixture's missing fleet files. */
const SHARED_HIT = /sentinel-shared\/(?!fleet-)[a-z-]+: \d+/;
const SHARED_PKG = (name) => ({ [`${name}/package.json`]: JSON.stringify({ name: `@sentinel/${name}` }) });

test('a glow in a shared package fails, named by package, file and line', () => {
  const out = withShared({
    ...SHARED_PKG('auth-ui'),
    'auth-ui/src/AuthScreen.tsx': 'export const A = () => (\n  <div className="shadow-[0_0_15px_var(--color-cyan-glow)]" />\n);\n',
  });
  assert.match(out, /FAIL {2}\[theme\] sentinel-shared\/auth-ui: 1 glow\(s\).*auth-ui\/src\/AuthScreen\.tsx:2 shadow-\[0_0_15px_var\(--color-cyan-glow\)\]/);
});

test('type under the floor in a shared package fails, and the written VesselKeeper form passes', () => {
  const out = withShared({
    ...SHARED_PKG('weather-ui'),
    'weather-ui/src/Forecast.tsx': '<p className="text-xs uppercase">a</p>\n<span className="text-[12px]">b</span>\n',
  });
  assert.match(out, /FAIL {2}\[type\] sentinel-shared\/weather-ui: 2 type size\(s\) below the 13px floor.*Forecast\.tsx:1 text-xs.*Forecast\.tsx:2 text-\[12px\]/);
  const phone = withShared({
    ...SHARED_PKG('ui'),
    'ui/src/AppShell.tsx': "const c = small ? 'text-[12px] sm:text-[13px]' : 'text-[13px]';\n",
  });
  assert.doesNotMatch(phone, SHARED_HIT);
});

test('a status-coloured labelled button in a shared package fails; an icon-only one does not', () => {
  const out = withShared({
    ...SHARED_PKG('weather-ui'),
    'weather-ui/src/Alerts.tsx':
      '<button onClick={() => pick(i)} className="p-3 bg-red/10 text-red">Gale warning</button>\n' +
      '<button onClick={() => close()} className="hover:bg-red/10" aria-label="Close"><X /></button>\n',
  });
  assert.match(out, /FAIL {2}\[ui\] sentinel-shared\/weather-ui: 1 labelled <button>\(s\).*Alerts\.tsx:1 bg-red\n/);
  // The icon-only close button on line 2 is not a labelled button.
  assert.doesNotMatch(out, /Alerts\.tsx:2/);
});

test('dist/, tests and packages without UI are not scanned', () => {
  const out = withShared({
    ...SHARED_PKG('ui'),
    'ui/src/Button.tsx': '<button className="h-12 rounded-md">Save</button>\n',
    'ui/dist/Button.js': 'jsx("div", { className: "text-xs shadow-[0_0_8px_var(--color-cyan-glow)]" });\n',
    'ui/tests/Button.test.tsx': '<p className="text-[9px]">fixture</p>\n',
    'ui/src/Button.test.tsx': '<p className="text-[9px]">fixture</p>\n',
    ...SHARED_PKG('marine'),
    'marine/src/format.ts': "export const cls = 'text-xs';\n",
  });
  assert.doesNotMatch(out, SHARED_HIT);
});

test('a clean shared package reports nothing', () => {
  const out = withShared({
    ...SHARED_PKG('ui'),
    'ui/src/StatusPill.tsx': '<span className="text-[13px] max-sm:sr-only shadow-[var(--panel-shadow)]">Instruments</span>\n',
  });
  assert.doesNotMatch(out, SHARED_HIT);
});
