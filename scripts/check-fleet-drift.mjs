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
import { fileURLToPath } from 'node:url';

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
  { glob: /(^|\/)Stepper\.(t|j)sx?$/, shared: '@sentinel/auth-ui' },
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
    for (const m of readText(f).matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) imports.add(m[1]);
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
// 7. The workflow pins sentinel-shared by SHA. Flag when that pin has fallen
//    behind, since apps would otherwise silently ship stale shared code.
// ---------------------------------------------------------------------------
const headFile = path.join(SHARED_ROOT, '.git', 'HEAD');
let sharedHead = null;
if (exists(headFile)) {
  const head = readText(headFile).trim();
  if (head.startsWith('ref: ')) {
    const refPath = path.join(SHARED_ROOT, '.git', head.slice(5).trim());
    if (exists(refPath)) sharedHead = readText(refPath).trim();
  } else sharedHead = head;
}
if (sharedHead) {
  for (const app of presentApps) {
    const wf = path.join(ROOT, app.name, '.github/workflows/build.yml');
    if (!exists(wf)) continue;
    const m = readText(wf).match(/repository:\s*\S*sentinel-shared[\s\S]{0,400}?ref:\s*([0-9a-f]{7,40})/);
    if (!m) { warn('pin', `${app.name}: shared checkout is not pinned to a SHA`); continue; }
    if (!sharedHead.startsWith(m[1]) && !m[1].startsWith(sharedHead.slice(0, m[1].length))) {
      warn('pin', `${app.name}: workflow pins sentinel-shared@${m[1].slice(0, 7)} but local HEAD is ${sharedHead.slice(0, 7)} — releases will not include newer shared changes`);
    }
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
const scope = presentApps.length > 1 ? 'full fleet' : `${presentApps[0].name} only (cross-app checks skipped)`;
console.log(`Fleet drift check — scope: ${scope}\n`);
const fails = results.filter((r) => r.level === 'FAIL');
const warns = results.filter((r) => r.level === 'WARN');
for (const r of [...fails, ...warns]) console.log(`  ${r.level}  [${r.area}] ${r.msg}`);
if (!results.length) console.log('  No drift detected.');
console.log(`\n${fails.length} failure(s), ${warns.length} warning(s).`);
process.exit(fails.length ? 1 : 0);
