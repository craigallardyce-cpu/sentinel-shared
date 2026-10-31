/**
 * The open-source licence list an app shows under Settings → About.
 *
 * Terms of Service §5 says each app lists its open-source components' licences
 * (Terms TF9), and most of those licences (MIT, BSD, ISC, Apache-2.0) require
 * their notice to ship with the software. Each app's Vite config adds
 * `licencesPlugin()` from here, which writes `third-party-licenses.json` into
 * the build output beside index.html, where `@sentinel/ui`'s About card fetches
 * it (`LICENCES_FILE`). It is part of the build, so it is never committed and
 * is always the list for exactly what was built.
 *
 * What counts, merged by name and version:
 *   - every npm package Vite put in the web bundle, read from the bundle's own
 *     module graph. The apps keep React, Leaflet and the rest in
 *     devDependencies so electron-builder does not package them twice, so the
 *     lockfile alone would miss them;
 *   - every package that is not dev-only in each `roots` lockfile: what the
 *     Electron main process and the backend load at run time.
 * Left out on purpose:
 *   - the fleet's own packages (`@sentinel/*`, `@mariner-sentinel/*`), which
 *     are ours and not open source;
 *   - optional packages that are not installed (another platform's binary);
 *   - build tools, which do not ship. Electron is one: electron-builder puts
 *     Chromium's and Electron's own notices (`LICENSES.chromium.html`,
 *     `LICENSE.electron.txt`) beside the installed app by itself.
 *   - Android's Gradle libraries (AndroidX), which are not npm packages;
 *     docs-kb ROADMAP tracks them.
 * Identical licence texts are stored once.
 *
 * As a command, for a look at what an app would list:
 *   node ../sentinel-shared/scripts/generate-licences.mjs --out <file> [--root <dir>]...
 * which reads the lockfiles only (no bundle), so it lists less than a build.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWN_SCOPES = ['@sentinel/', '@mariner-sentinel/'];
/** The files a package's licence and notice live in, in the order they are joined. */
const LICENCE_FILE = /^(licen[cs]e|copying|unlicen[cs]e)([-._].*)?$/i;
const NOTICE_FILE = /^notice([-._].*)?$/i;

export function parseArgs(argv) {
  const opts = { out: null, roots: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '--root') {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      if (a === '--out') opts.out = v;
      else opts.roots.push(v);
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (!opts.out) throw new Error('--out is required');
  if (opts.roots.length === 0) opts.roots.push('.');
  return opts;
}

/** The package name a lockfile key installs, e.g. "node_modules/a/node_modules/@b/c" → "@b/c". */
export function nameFromKey(key) {
  const i = key.lastIndexOf('node_modules/');
  return i < 0 ? null : key.slice(i + 'node_modules/'.length);
}

/** Lockfile entries that ship: not dev-only, not a link, not one of ours. */
export function shippedEntries(lock) {
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!key.includes('node_modules/')) continue;
    if (entry.dev || entry.link) continue;
    const name = entry.name || nameFromKey(key);
    if (!name || OWN_SCOPES.some((s) => name.startsWith(s))) continue;
    out.push({ key, name, version: entry.version || '', license: entry.license || '', optional: !!entry.optional });
  }
  return out;
}

/** The licence text a package ships, LICENSE first and NOTICE after it, or null. */
export function readLicenceText(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return null;
  }
  const pick = (re) => files.filter((f) => re.test(f)).sort();
  const parts = [...pick(LICENCE_FILE), ...pick(NOTICE_FILE)].map((f) => readFileSync(join(dir, f), 'utf8').trim());
  return parts.length ? parts.join('\n\n') : null;
}

/** The SPDX licence a package states, from its own package.json when the lockfile has none. */
function statedLicence(dir, fromLock) {
  if (fromLock) return fromLock;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (typeof pkg.license === 'string') return pkg.license;
    if (pkg.license?.type) return pkg.license.type;
    if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ');
  } catch {
    /* not installed */
  }
  return 'UNKNOWN';
}

/**
 * The installed package a resolved module id belongs to, or null when the
 * module is not inside a node_modules folder (the app's own code, the fleet's
 * shared packages through their file: links, Vite's virtual modules).
 */
export function packageDirOf(id) {
  const clean = String(id).split('?')[0].replace(/\\/g, '/');
  if (clean.startsWith('\0')) return null;
  const i = clean.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = clean.slice(i + '/node_modules/'.length).split('/');
  const n = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length <= n) return null;
  return clean.slice(0, i) + '/node_modules/' + rest.slice(0, n).join('/');
}

function readPackageJson(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function collect(roots, packageDirs = []) {
  const byId = new Map();
  for (const dir of packageDirs) {
    const pkg = readPackageJson(dir);
    if (!pkg?.name || OWN_SCOPES.some((s) => pkg.name.startsWith(s))) continue;
    const id = `${pkg.name}@${pkg.version || ''}`;
    if (byId.has(id)) continue;
    byId.set(id, { name: pkg.name, version: pkg.version || '', license: statedLicence(dir, ''), text: readLicenceText(dir) });
  }
  for (const root of roots) {
    const lockPath = join(root, 'package-lock.json');
    if (!existsSync(lockPath)) throw new Error(`No package-lock.json in ${resolve(root)}`);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const e of shippedEntries(lock)) {
      const dir = join(root, e.key);
      if (!existsSync(join(dir, 'package.json'))) {
        if (e.optional) continue; // another platform's optional binary
        // Listed in the lockfile but not installed: still list it, without text.
      }
      const id = `${e.name}@${e.version}`;
      if (byId.has(id)) continue;
      byId.set(id, { name: e.name, version: e.version, license: statedLicence(dir, e.license), text: readLicenceText(dir) });
    }
  }
  const packages = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const texts = [];
  const index = new Map();
  return {
    generatedAt: new Date().toISOString(),
    packages: packages.map((p) => {
      let t = -1;
      if (p.text) {
        if (!index.has(p.text)) {
          index.set(p.text, texts.length);
          texts.push(p.text);
        }
        t = index.get(p.text);
      }
      return { name: p.name, version: p.version, license: p.license, text: t };
    }),
    texts,
  };
}

/**
 * The Vite plugin each app adds to its config. `roots` are the folders whose
 * lockfiles name what the app loads outside the web bundle (the repo root for
 * Electron's main process and a bundled backend; OceanSentinel's backend/).
 */
export function licencesPlugin({ roots = [], fileName = 'third-party-licenses.json' } = {}) {
  return {
    name: 'sentinel-licences',
    apply: 'build',
    generateBundle() {
      const dirs = new Set();
      for (const id of this.getModuleIds()) {
        const dir = packageDirOf(id);
        if (dir) dirs.add(dir);
      }
      const file = collect(roots, [...dirs].sort());
      this.emitFile({ type: 'asset', fileName, source: JSON.stringify(file) });
    },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const file = collect(opts.roots);
  mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(file));
  const missing = file.packages.filter((p) => p.text < 0).length;
  console.log(
    `generate-licences: ${file.packages.length} packages, ${file.texts.length} distinct licence texts` +
      (missing ? `, ${missing} with no licence file` : '') +
      ` -> ${opts.out}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`generate-licences: ${err.message}`);
    process.exit(1);
  }
}
