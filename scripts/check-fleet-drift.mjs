#!/usr/bin/env node
/**
 * Fleet drift checker for the Mariner Sentinel apps.
 *
 * Every check here corresponds to a bug that actually happened, not a
 * hypothetical. Several were invisible locally and only failed on a clean
 * checkout, which is exactly the class this script exists to catch early.
 *
 * Runs in two scopes, using the same sibling layout in both:
 *   - Locally from Projects/ : sees all three apps, so cross-app checks run.
 *   - In an app's CI         : sees that app + sentinel-shared, so app-scoped
 *                              checks run and cross-app ones are skipped.
 *
 * Usage:  node sentinel-shared/scripts/check-fleet-drift.mjs
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHARED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SHARED_ROOT, '..');

const APPS = [
  {
    name: 'OceanSentinel',
    // Capacitor/Android live under frontend/ for this app, unlike the other two.
    viteConfig: 'frontend/vite.config.js',
    androidDir: 'frontend/android',
    // dist/server.cjs is bundled at the repo root with --packages=external, so it
    // resolves runtime deps from the ROOT node_modules, not backend/'s. Any runtime
    // dep of the backend must therefore also appear in the root package.json.
    mirrorsBackendDeps: true,
  },
  { name: 'HarborSentinel', viteConfig: 'vite.config.ts', androidDir: 'android' },
  { name: 'VesselKeeper', viteConfig: 'vite.config.ts', androidDir: 'android' },
];

// Packages that must not diverge across apps: they are either shared-package peer
// deps (where two copies cause duplicate-instance bugs) or platform deps where a
// version split silently changes behaviour on one app only.
const ALIGNED_DEPS = [
  'react', 'react-dom', 'lucide-react', 'motion',
  '@capacitor/core', '@capacitor/device', '@capacitor/android',
  '@supabase/supabase-js', 'tailwindcss',
];

// Modules that were extracted into @sentinel/*. A local file matching these names
// reappearing usually means a copy crept back in.
const RECOPY_PATTERNS = [
  { glob: /(^|\/)Stepper\.(t|j)sx?$/, shared: '@sentinel/ui' },
  { glob: /(^|\/)AuthScreen\.(t|j)sx?$/, shared: '@sentinel/auth-ui' },
  { glob: /(^|\/)(nmeaParser|aisParser|geo-utils|navigation)\.(t|j)s$/, shared: '@sentinel/marine' },
  { glob: /(^|\/)shared\/weather\//, shared: '@sentinel/weather-ui' },
];

const results = [];
const record = (level, area, msg) => results.push({ level, area, msg });
const fail = (area, msg) => record('FAIL', area, msg);
const warn = (area, msg) => record('WARN', area, msg);

const exists = (p) => fs.existsSync(p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readText = (p) => fs.readFileSync(p, 'utf8');

/**
 * Run git inside sentinel-shared. Returns trimmed stdout, or null if git is
 * missing or the command fails -- including the deliberate non-zero exits of
 * query commands like `cat-file -e` and `merge-base --is-ancestor`, where null
 * simply means "no". Callers degrade instead of crashing, so a checkout without
 * usable git history still runs every other check.
 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: SHARED_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function walk(dir, out = [], depth = 0) {
  if (depth > 8 || !exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'dist-electron', 'build', 'android', 'ios'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
  return out;
}

const presentApps = APPS.filter((a) => exists(path.join(ROOT, a.name, 'package.json')));
if (presentApps.length === 0) {
  console.error(`No Sentinel apps found next to ${SHARED_ROOT}. Expected siblings like ${ROOT}/HarborSentinel.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Cross-app dependency alignment. A split here reintroduces duplicate-instance
//    bugs (two Reacts) or means one app quietly behaves differently.
// ---------------------------------------------------------------------------
if (presentApps.length > 1) {
  const seen = new Map(); // dep -> Map(range -> [app])
  for (const app of presentApps) {
    // Collect from every package.json that declares deps, since OceanSentinel
    // splits its frontend deps into a nested package.
    const pkgFiles = [path.join(ROOT, app.name, 'package.json')];
    for (const sub of ['frontend', 'backend']) {
      const p = path.join(ROOT, app.name, sub, 'package.json');
      if (exists(p)) pkgFiles.push(p);
    }
    for (const f of pkgFiles) {
      const pkg = readJson(f);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const dep of ALIGNED_DEPS) {
        if (!deps[dep]) continue;
        if (!seen.has(dep)) seen.set(dep, new Map());
        const byRange = seen.get(dep);
        if (!byRange.has(deps[dep])) byRange.set(deps[dep], []);
        byRange.get(deps[dep]).push(app.name);
      }
    }
  }
  for (const [dep, byRange] of seen) {
    if (byRange.size > 1) {
      const detail = [...byRange.entries()].map(([r, apps]) => `${r} (${[...new Set(apps)].join(', ')})`).join('  vs  ');
      fail('deps', `${dep} versions differ: ${detail}`);
    }
  }

  // 2. App versions should stay aligned - the fleet released as one at v2.8.0.
  const versions = new Map();
  for (const app of presentApps) {
    const v = readJson(path.join(ROOT, app.name, 'package.json')).version;
    if (!versions.has(v)) versions.set(v, []);
    versions.get(v).push(app.name);
  }
  if (versions.size > 1) {
    warn('version', `app versions differ: ${[...versions.entries()].map(([v, a]) => `${v} (${a.join(', ')})`).join('  vs  ')}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Vite must be able to resolve every bare import the shared packages make.
//    file: deps are symlinks, so Vite resolves those imports from sentinel-shared
//    rather than the app. This passes locally whenever sentinel-shared happens to
//    have node_modules installed, and fails on a clean checkout (i.e. CI).
// ---------------------------------------------------------------------------
const sharedImports = new Map(); // package name -> Set(bare imports)
for (const dir of fs.readdirSync(SHARED_ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === 'scripts' || dir.name === '.git') continue;
  const distDir = path.join(SHARED_ROOT, dir.name, 'dist');
  if (!exists(distDir)) continue;
  const imports = new Set();
  for (const f of walk(distDir)) {
    if (!f.endsWith('.js')) continue;
    // Anchored to an import/export statement: a bare `from "..."` also matches
    // prose in comments, and auth-ui's dist has one ("distinct from "could not
    // check"") that reported a phantom dependency on every run.
    const src = readText(f);
    const statements = /(?:^|[;}\s])(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'".][^'"]*)['"]/g;
    for (const m of src.matchAll(statements)) imports.add(m[1]);
    for (const m of src.matchAll(/\bimport\s+['"]([^'".][^'"]*)['"]/g)) imports.add(m[1]);
  }
  sharedImports.set(`@sentinel/${dir.name}`, imports);
}

for (const app of presentApps) {
  const vitePath = path.join(ROOT, app.name, app.viteConfig);
  if (!exists(vitePath)) { warn('vite', `${app.name}: ${app.viteConfig} not found`); continue; }
  const viteSrc = readText(vitePath);
  const aliased = new Set([...viteSrc.matchAll(/['"]([^'"]+)['"]\s*:\s*path\.resolve/g)].map((m) => m[1]));

  // Only consider shared packages this app actually depends on.
  const declared = new Set();
  for (const sub of ['', 'frontend']) {
    const p = path.join(ROOT, app.name, sub, 'package.json');
    if (!exists(p)) continue;
    const pkg = readJson(p);
    for (const d of Object.keys(pkg.dependencies || {})) if (d.startsWith('@sentinel/')) declared.add(d);
  }
  for (const shared of declared) {
    for (const imp of sharedImports.get(shared) || []) {
      // An alias on 'react' also covers 'react/jsx-runtime'.
      const covered = [...aliased].some((a) => imp === a || imp.startsWith(a + '/'));
      if (!covered) {
        fail('vite', `${app.name}: ${shared} imports "${imp}" but ${app.viteConfig} has no alias for it — will fail on a clean checkout`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Local re-copies of code that now lives in @sentinel/*.
// ---------------------------------------------------------------------------
for (const app of presentApps) {
  const srcDir = path.join(ROOT, app.name, exists(path.join(ROOT, app.name, 'frontend', 'src')) ? 'frontend/src' : 'src');
  for (const f of walk(srcDir)) {
    const rel = path.relative(path.join(ROOT, app.name), f).replace(/\\/g, '/');
    for (const p of RECOPY_PATTERNS) {
      if (!p.glob.test(rel)) continue;
      // A thin wrapper re-exporting the shared component is the intended pattern.
      const body = readText(f);
      if (body.includes(p.shared)) continue;
      fail('recopy', `${app.name}: ${rel} looks like a local copy of code owned by ${p.shared}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Android parity + the applicationId/appId relationship.
// ---------------------------------------------------------------------------
for (const app of presentApps) {
  const aDir = path.join(ROOT, app.name, app.androidDir);
  const manifest = path.join(aDir, 'app/src/main/AndroidManifest.xml');
  const gradle = path.join(aDir, 'app/build.gradle');
  if (!exists(manifest) || !exists(gradle)) { warn('android', `${app.name}: no Android project at ${app.androidDir}`); continue; }

  const mSrc = readText(manifest);
  const gSrc = readText(gradle);

  // Orientation policy: phones lock to portrait, tablets rotate freely. That
  // cannot be expressed by android:screenOrientation, which has no screen-size
  // qualifier, so it is a resource-qualified bool read in MainActivity. A hard
  // manifest lock would override it and break landscape on tablets — which is
  // what review finding A2 was about — so it is rejected here.
  if (/android:screenOrientation="portrait"/.test(mSrc)) {
    fail('android', `${app.name}: manifest hard-locks portrait, which also locks tablets — use the portrait_only bool instead (review finding A2)`);
  }
  const boolsDefault = path.join(aDir, 'app/src/main/res/values/bools.xml');
  const boolsTablet = path.join(aDir, 'app/src/main/res/values-sw600dp/bools.xml');
  const mainActivity = walk(path.join(aDir, 'app/src/main/java')).find((f) => f.endsWith('MainActivity.java'));
  const okDefault = exists(boolsDefault) && /name="portrait_only">true</.test(readText(boolsDefault));
  const okTablet = exists(boolsTablet) && /name="portrait_only">false</.test(readText(boolsTablet));
  const okActivity = mainActivity && /R\.bool\.portrait_only/.test(readText(mainActivity)) && /SCREEN_ORIENTATION_PORTRAIT/.test(readText(mainActivity));
  if (!okDefault) fail('android', `${app.name}: res/values/bools.xml must set portrait_only=true (phones lock to portrait)`);
  if (!okTablet) fail('android', `${app.name}: res/values-sw600dp/bools.xml must set portrait_only=false (tablets rotate freely)`);
  if (!okActivity) fail('android', `${app.name}: MainActivity must apply R.bool.portrait_only via setRequestedOrientation`);
  if (!/android:networkSecurityConfig=/.test(mSrc)) fail('android', `${app.name}: no networkSecurityConfig referenced`);
  if (!exists(path.join(aDir, 'app/src/main/res/xml/network_security_config.xml'))) {
    fail('android', `${app.name}: network_security_config.xml missing`);
  }
  // A foreground service must declare a type and its matching permission.
  if (/<service[^>]*foregroundservice/i.test(mSrc)) {
    if (!/android:foregroundServiceType=/.test(mSrc)) fail('android', `${app.name}: foreground service without foregroundServiceType`);
    if (!/FOREGROUND_SERVICE"/.test(mSrc)) fail('android', `${app.name}: foreground service without FOREGROUND_SERVICE permission`);
  }
  // versionName must derive from package.json, not be hardcoded or clock-based.
  const derives = /appVersionName|packageJson\.version/.test(gSrc) ||
    /appVersionName/.test(exists(path.join(aDir, 'variables.gradle')) ? readText(path.join(aDir, 'variables.gradle')) : '');
  if (!derives) fail('android', `${app.name}: versionName is not derived from package.json`);

  const appIdMatch = gSrc.match(/applicationId\s+["']([^"']+)["']/);
  const electronAppId = readJson(path.join(ROOT, app.name, 'package.json'))?.build?.appId;
  if (appIdMatch && electronAppId && appIdMatch[1] !== electronAppId) {
    fail('android', `${app.name}: applicationId "${appIdMatch[1]}" != Electron build.appId "${electronAppId}"`);
  }
}

// ---------------------------------------------------------------------------
// 6. OceanSentinel bundles its backend to the repo root, so root package.json
//    must mirror the backend's runtime deps or the packaged app dies at startup.
// ---------------------------------------------------------------------------
for (const app of presentApps.filter((a) => a.mirrorsBackendDeps)) {
  const rootPkg = path.join(ROOT, app.name, 'package.json');
  const backendPkg = path.join(ROOT, app.name, 'backend/package.json');
  if (!exists(backendPkg)) continue;
  const rootDeps = readJson(rootPkg).dependencies || {};
  const backendDeps = readJson(backendPkg).dependencies || {};
  for (const dep of Object.keys(backendDeps)) {
    if (!rootDeps[dep]) {
      fail('bundle', `${app.name}: backend depends on "${dep}" but it is missing from the root package.json — dist/server.cjs resolves from root and will fail at runtime`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. The workflow pins sentinel-shared by SHA.
//
//    A pin only means anything against what is PUBLISHED. actions/checkout
//    fetches the pinned ref from GitHub, so a SHA that exists only on somebody's
//    machine does not produce a stale build -- it produces no build at all, in
//    all three apps at once.
//
//    This check used to compare the pin against local HEAD, and was wrong in
//    both directions: it warned whenever the shared repo had unpushed commits
//    (including deliberate WIP that must never be released), while staying
//    silent on the one case that actually breaks CI. Compare against
//    origin/main, and treat an unpublished pin as a failure rather than a nag.
//
//    Staleness is measured against the last published commit that touched
//    something an app actually builds against -- not against the tip. Editing
//    this script, or a README, moves the tip without changing a single byte any
//    app consumes, and a pin "behind" only such commits is not stale at all.
//    Warning about it would be noise, and noise in a category teaches the reader
//    to skip the category, which is how a real warning gets missed.
// ---------------------------------------------------------------------------
const publishedHead = git(['rev-parse', 'origin/main']);
// Ancestry is meaningless in a shallow clone, so downgrade to a warning there
// rather than accusing a perfectly good pin of being unpushed.
const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';

// Paths in sentinel-shared that no app build consumes. Everything else counts,
// so a new package directory is treated as consumable by default -- the
// fail-safe direction, since the cost of a spurious warning is far below the
// cost of silently shipping stale shared code.
const NOT_CONSUMED = ['scripts/', 'skills/', '*.md', '.gitignore'];

/**
 * The newest published commit touching a path an app builds against, or null if
 * that cannot be determined (no git, shallow clone) -- in which case callers
 * fall back to the tip and simply warn slightly more often.
 */
const releaseHead = shallow ? null : git([
  'rev-list', '-n', '1', 'origin/main', '--', '.',
  ...NOT_CONSUMED.map((p) => `:(exclude)${p}`),
]);

for (const app of presentApps) {
  const wf = path.join(ROOT, app.name, '.github/workflows/build.yml');
  if (!exists(wf)) continue;
  const m = readText(wf).match(/repository:\s*\S*sentinel-shared[\s\S]{0,400}?ref:\s*([0-9a-f]{7,40})/);
  if (!m) { warn('pin', `${app.name}: shared checkout is not pinned to a SHA`); continue; }

  const pin = m[1];
  if (!publishedHead) {
    warn('pin', `${app.name}: cannot resolve sentinel-shared origin/main, so the pin ${pin.slice(0, 7)} could not be checked`);
    continue;
  }
  if (publishedHead.startsWith(pin)) continue; // pinned to the published tip

  const known = git(['cat-file', '-e', `${pin}^{commit}`]) !== null;
  const published = known && !shallow && git(['merge-base', '--is-ancestor', pin, 'origin/main']) !== null;

  if (!known || shallow) {
    warn('pin', `${app.name}: pins sentinel-shared@${pin.slice(0, 7)}, which this checkout cannot verify is on the remote — confirm it is pushed`);
  } else if (!published) {
    fail('pin', `${app.name}: pins sentinel-shared@${pin.slice(0, 7)}, which has never been pushed — actions/checkout cannot fetch it and the release build will fail`);
  } else if (releaseHead && git(['merge-base', '--is-ancestor', releaseHead, pin]) !== null) {
    continue; // behind the tip, but carries every shared change an app builds against
  } else {
    const target = releaseHead || publishedHead;
    warn('pin', `${app.name}: pins sentinel-shared@${pin.slice(0, 7)} but the newest shared change an app builds against is ${target.slice(0, 7)} — releases will not include it`);
  }
}

// ---------------------------------------------------------------------------
// 8. Palette integrity.
//
//    All three apps import @sentinel/theme/index.css, which carries the raw tokens,
//    the Tailwind @theme role map (roles.css), night mode and the glass surfaces.
//    The checks are therefore the same for every app:
//      - the import is present;
//      - no :root block redefines a shared token (scoped overrides such as
//        .theme-night are fine, and live in the shared package anyway);
//      - no app-local @theme declares a literal-hex --color-* role. HarborSentinel
//        used to carry a full Material palette with rotated primary/secondary roles,
//        which is how `text-secondary` came to mean cyan there and orange elsewhere.
// ---------------------------------------------------------------------------
const tokensFile = path.join(SHARED_ROOT, 'theme/tokens.css');
if (exists(tokensFile)) {
  const sharedTokens = new Map(
    [...readText(tokensFile).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );
  const APP_CSS = {
    OceanSentinel: 'frontend/src/index.css',
    HarborSentinel: 'src/index.css',
    VesselKeeper: 'src/client/index.css',
  };

  for (const app of presentApps) {
    const rel = APP_CSS[app.name];
    if (!rel) continue;
    const cssPath = path.join(ROOT, app.name, rel);
    if (!exists(cssPath)) continue;
    const src = readText(cssPath);
    if (!src.includes('@sentinel/theme/index.css')) {
      fail('theme', `${app.name}: does not import @sentinel/theme/index.css`);
      continue;
    }
    // Only :root counts as redefining the base palette. ":root" must start a line,
    // so a descendant selector like ".theme-night :root" is not mistaken for it.
    for (const block of src.matchAll(/^[ \t]*:root\s*\{([^}]*)\}/gm)) {
      for (const [name] of sharedTokens) {
        if (new RegExp(`(^|\\s)${name}\\s*:`, 'm').test(block[1])) {
          fail('theme', `${app.name}: :root redefines shared token ${name} — it should come from @sentinel/theme`);
        }
      }
    }
    // App-local @theme blocks may add layout tokens, but colour roles belong to roles.css.
    for (const block of src.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
      for (const m of block[1].matchAll(/(--color-[a-z0-9-]+):\s*#[0-9a-fA-F]{3,8}\s*;/g)) {
        fail('theme', `${app.name}: local @theme declares ${m[1]} as a literal hex — colour roles come from @sentinel/theme/roles.css`);
      }
    }
    // @sentinel/ui ships Tailwind class names in its dist; each consuming app must
    // point Tailwind at it or the primitives render unstyled.
    const appPkg = path.join(ROOT, app.name, app.name === 'OceanSentinel' ? 'frontend/package.json' : 'package.json');
    if (exists(appPkg) && /"@sentinel\/ui"/.test(readText(appPkg)) && !/@source\s+"[^"]*@sentinel\/ui\/dist"/.test(src)) {
      fail('theme', `${app.name}: depends on @sentinel/ui but ${rel} has no @source for @sentinel/ui/dist — its classes will be missing`);
    }
    if (/^\s*\.(theme-night|night-mode)\s*\{/m.test(src)) {
      warn('theme', `${app.name}: declares its own .theme-night/.night-mode token block — @sentinel/theme/night.css already provides it`);
    }
  }
}

// ---------------------------------------------------------------------------
// 9. The sentinel-check skill is canonical here but gets installed to the user's
//    ~/.claude/skills. Warn only if an installed copy exists and has diverged;
//    staying silent when it is absent, since not every machine installs it.
// ---------------------------------------------------------------------------
const canonicalSkill = path.join(SHARED_ROOT, 'skills/sentinel-check/SKILL.md');
const home = process.env.HOME || process.env.USERPROFILE;
if (home && exists(canonicalSkill)) {
  const installed = path.join(home, '.claude/skills/sentinel-check/SKILL.md');
  if (exists(installed) && readText(installed) !== readText(canonicalSkill)) {
    warn('skill', 'installed ~/.claude/skills/sentinel-check/SKILL.md differs from the canonical copy in sentinel-shared — re-copy it');
  }
}

// ---------------------------------------------------------------------------
// 10. Settings drift.
//
//     Nine checks never noticed that `harbor_sentinel_keep_awake` and
//     `ocean_sentinel_keep_awake` were one setting under two names, that
//     OceanSentinel shipped three different NMEA gateway defaults (one of them a
//     home LAN address), or that a boat name lived in four places under three
//     names with two of them disagreeing. None of that is visible to a checker
//     that only reads dependencies and build config.
//
//     @sentinel/settings makes it visible, because a setting is now a
//     declaration: what it is, what it defaults to, and where it used to live.
//     Everything below is derived from that registry rather than restated here,
//     so declaring a setting extends these checks for free.
//
//     Both the apps AND the shared packages are scanned. Reading a real install's
//     storage turned up keys no check knew about -- harborsentinel_access_*,
//     harbor_sentinel_chart_providers, weather_alerts -- because @sentinel/* wrote
//     them rather than app source, so a setting could drift there and nothing
//     would notice.
//
//     WARN for now, deliberately. Both apps still carry their pre-registry keys
//     on purpose -- they are read for one release so an upgrade loses nothing --
//     and a check that fails on a planned intermediate state teaches people to
//     ignore it. This turns FAIL when those keys are deleted.
// ---------------------------------------------------------------------------
const APP_REGISTRY_KEY = {
  OceanSentinel: 'ocean',
  HarborSentinel: 'harbor',
  VesselKeeper: 'vessel-keeper',
};

// Each app's own settings module is the one place allowed to touch a legacy key:
// that is where the migration reads them from.
const SETTINGS_MODULE = /(^|\/)lib\/settings\.(t|j)s$/;

let FLEET_SETTINGS = null;
let DEFAULT_NMEA_TARGET = null;
try {
  const settingsDist = path.join(SHARED_ROOT, 'settings/dist/index.js');
  const marineDist = path.join(SHARED_ROOT, 'marine/dist/index.js');
  if (exists(settingsDist) && exists(marineDist)) {
    ({ FLEET_SETTINGS } = await import(pathToFileURL(settingsDist).href));
    ({ DEFAULT_NMEA_TARGET } = await import(pathToFileURL(marineDist).href));
  }
} catch (err) {
  warn('settings', `could not load the settings registry, so check 10 was skipped: ${err.message}`);
}

if (FLEET_SETTINGS && DEFAULT_NMEA_TARGET) {
  // Every legacy key any app ever used, and which setting owns it.
  const ownerOfLegacyKey = new Map(); // `${app}:${key}` -> setting key
  const allLegacyKeys = new Set();
  for (const def of FLEET_SETTINGS.all()) {
    for (const [app, keys] of Object.entries(def.legacy ?? {})) {
      for (const key of keys) {
        ownerOfLegacyKey.set(`${app}:${key}`, def.key);
        allLegacyKeys.add(key);
      }
    }
  }

  for (const app of presentApps) {
    const appRoot = path.join(ROOT, app.name);
    const srcDir = path.join(appRoot, exists(path.join(appRoot, 'frontend', 'src')) ? 'frontend/src' : 'src');
    const files = [...walk(srcDir), ...walk(path.join(appRoot, 'server'))].filter((f) => /\.(t|j)sx?$/.test(f));
    const appKey = APP_REGISTRY_KEY[app.name];

    const usedKeys = new Set();
    const directUses = [];
    const foreignNames = [];
    const gatewayLiterals = [];

    for (const file of files) {
      const rel = path.relative(appRoot, file).replace(/\\/g, '/');
      const isSettingsModule = SETTINGS_MODULE.test(rel);

      let inBlockComment = false;

      readText(file).split(/\r?\n/).forEach((line, i) => {
        const at = `${rel}:${i + 1}`;

        /*
          Track block comments across lines rather than guessing per line.

          A star-prefixed continuation is only one house style; this repository
          also writes block comments whose body lines carry no marker at all, and
          those were read as code -- the first thing this check flagged was a
          comment explaining the very literal it was flagging.
        */
        const wasInBlockComment = inBlockComment;
        const opensBlock = line.lastIndexOf('/*');
        const closesBlock = line.lastIndexOf('*/');
        if (inBlockComment) {
          if (closesBlock !== -1) inBlockComment = false;
        } else if (opensBlock !== -1 && closesBlock < opensBlock) {
          inBlockComment = true;
        }
        const isComment = wasInBlockComment || inBlockComment || line.trim().startsWith('//');

        /*
          10a. A registry-owned key still read or written by hand.

          Not untidiness. A setting held at the vessel or account layer is
          SHADOWED by that layer, so a localStorage write to it stores nothing
          anybody reads and the screen appears not to save -- which is exactly
          what OceanSentinel's settings dialog did until it was found by hand.
        */
        // The first argument only. Matching every quoted string on the line
        // collected the VALUES too, which made a stored '100' look like a key.
        for (const m of isComment ? [] : line.matchAll(/localStorage\s*\.\s*(?:get|set|remove)Item\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
          {
            const key = m[1];
            usedKeys.add(key);

            if (ownerOfLegacyKey.has(`${appKey}:${key}`)) {
              if (!isSettingsModule) directUses.push(`${at} -> ${ownerOfLegacyKey.get(`${appKey}:${key}`)}`);
              continue;
            }

            /*
              10b. One setting, one name.

              Reading another app's key name is how two names for one setting
              begin, and it is what nine existing checks missed for
              harbor_sentinel_keep_awake and ocean_sentinel_keep_awake.
            */
            for (const [owned, setting] of ownerOfLegacyKey) {
              const split = owned.indexOf(':');
              if (owned.slice(0, split) !== appKey && owned.slice(split + 1) === key) {
                foreignNames.push(`${at} uses ${key}, which belongs to ${setting}`);
              }
            }
          }
        }

        /*
          10c. The fleet's one gateway literal, copied into an app.

          A placeholder or a comment is where an example address belongs; a code
          path is not. OceanSentinel had three of these and they disagreed.
        */
        // The host only. A bare port number matches far too much to be a signal,
        // and it was never the part that disagreed -- three addresses were.
        if (!isComment && !/placeholder/i.test(line) && line.includes(DEFAULT_NMEA_TARGET.host)) {
          gatewayLiterals.push(at);
        }
      });
    }

    const some = (list, n) => list.slice(0, n).join(', ') + (list.length > n ? `, +${list.length - n} more` : '');

    if (directUses.length) {
      warn('settings', `${app.name}: ${directUses.length} direct localStorage use(s) of a registry-owned key ` +
        `— a value held above the device layer is shadowed, so the write saves nothing: ${some(directUses, 4)}`);
    }
    if (foreignNames.length) {
      warn('settings', `${app.name}: ${foreignNames.length} use(s) of another app's key name for a shared setting: ${some(foreignNames, 3)}`);
    }
    if (gatewayLiterals.length) {
      warn('settings', `${app.name}: ${gatewayLiterals.length} copy/copies of the gateway literal ` +
        `(${DEFAULT_NMEA_TARGET.host}) outside a placeholder or comment: ${some(gatewayLiterals, 4)}`);
    }

    /*
      10d. Flat keys the registry has never heard of.

      Most are cached records or credentials rather than settings, which is the
      point: this number is the size of the remaining question, and it should
      only ever go down.
    */
    const undeclared = [...usedKeys].filter((k) => !allLegacyKeys.has(k) && !k.startsWith('sentinel.'));
    if (undeclared.length) {
      warn('settings', `${app.name}: ${undeclared.length} localStorage key(s) not declared in the registry ` +
        `(cached data and credentials belong here; settings do not): ${some(undeclared, 6)}`);
    }
  }

  /*
    The shared packages, which the app scan above cannot see.

    Reading a real install's storage turned up keys no check knew about --
    harborsentinel_access_entitlements, harbor_sentinel_chart_providers,
    weather_alerts and others -- because they are written by @sentinel/* rather
    than by app source. A setting could drift there and nothing would notice,
    which is the exact hole this check exists to close.

    The rule is the one @sentinel/settings already follows: a shared package takes
    a StorageLike and lets the app supply it. Reaching for the localStorage global
    instead makes a package unusable server-side, untestable without a DOM, and --
    the reason it matters here -- lets it write keys that neither the registry nor
    any check can see, because they are composed at runtime from a prop rather
    than written as literals.
  */
  for (const dir of fs.readdirSync(SHARED_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory() || ['scripts', '.git', '.github', 'node_modules'].includes(dir.name)) continue;
    const pkgSrc = path.join(SHARED_ROOT, dir.name, 'src');
    if (!exists(pkgSrc)) continue;

    const globalUses = [];
    const ownedKeys = [];

    for (const file of walk(pkgSrc).filter((f) => /\.(t|j)sx?$/.test(f))) {
      const rel = `${dir.name}/${path.relative(pkgSrc, file).replace(/\\/g, '/')}`;
      let inBlockComment = false;

      readText(file).split(/\r?\n/).forEach((line, i) => {
        const wasInBlockComment = inBlockComment;
        const opensBlock = line.lastIndexOf('/*');
        const closesBlock = line.lastIndexOf('*/');
        if (inBlockComment) {
          if (closesBlock !== -1) inBlockComment = false;
        } else if (opensBlock !== -1 && closesBlock < opensBlock) {
          inBlockComment = true;
        }
        if (wasInBlockComment || inBlockComment || line.trim().startsWith('//') || line.trim().startsWith('*')) return;

        if (/\blocalStorage\s*\./.test(line)) globalUses.push(`${rel}:${i + 1}`);

        /*
          Not for the registry itself. @sentinel/settings is where these names are
          DECLARED -- that is the whole job -- and its column map happens to
          contain `vessel_type`, which is a Postgres column that collides with one
          of OceanSentinel's old key names.
        */
        if (dir.name !== 'settings') {
          for (const m of line.matchAll(/['"`]([A-Za-z0-9_.]+)['"`]/g)) {
            if (allLegacyKeys.has(m[1])) ownedKeys.push(`${rel}:${i + 1} -> ${m[1]}`);
          }
        }
      });
    }

    const some = (list, n) => list.slice(0, n).join(', ') + (list.length > n ? `, +${list.length - n} more` : '');

    if (globalUses.length) {
      warn('settings', `@sentinel/${dir.name}: ${globalUses.length} direct use(s) of the localStorage global — ` +
        `take a StorageLike from the app instead, as @sentinel/settings does, or the keys it writes stay invisible ` +
        `to the registry and to this check: ${some(globalUses, 3)}`);
    }
    if (ownedKeys.length) {
      warn('settings', `@sentinel/${dir.name}: writes a key the registry owns, from a package all three apps install: ${some(ownedKeys, 3)}`);
    }
  }
}

// ---------------------------------------------------------------------------
const scope = presentApps.length > 1 ? 'full fleet' : `${presentApps[0].name} only (cross-app checks skipped)`;
console.log(`Fleet drift check — scope: ${scope}\n`);
const fails = results.filter((r) => r.level === 'FAIL');
const warns = results.filter((r) => r.level === 'WARN');
for (const r of [...fails, ...warns]) console.log(`  ${r.level}  [${r.area}] ${r.msg}`);
if (!results.length) console.log('  No drift detected.');
console.log(`\n${fails.length} failure(s), ${warns.length} warning(s).`);
process.exit(fails.length ? 1 : 0);
