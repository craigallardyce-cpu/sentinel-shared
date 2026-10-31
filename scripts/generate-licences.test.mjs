import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, nameFromKey, shippedEntries, readLicenceText, collect, packageDirOf, licencesPlugin } from './generate-licences.mjs';

test('parseArgs needs --out and defaults the root to the current directory', () => {
  assert.deepEqual(parseArgs(['--out', 'public/x.json']), { out: 'public/x.json', roots: ['.'] });
  assert.deepEqual(parseArgs(['--out', 'o', '--root', '.', '--root', 'frontend']).roots, ['.', 'frontend']);
  assert.throws(() => parseArgs([]), /--out is required/);
  assert.throws(() => parseArgs(['--out']), /needs a value/);
  assert.throws(() => parseArgs(['--out', 'o', 'stray']), /Unexpected argument/);
});

test('nameFromKey reads nested and scoped installs', () => {
  assert.equal(nameFromKey('node_modules/react'), 'react');
  assert.equal(nameFromKey('node_modules/a/node_modules/@b/c'), '@b/c');
  assert.equal(nameFromKey('../sentinel-shared/ui'), null);
});

test('shippedEntries drops dev-only packages, links and the fleet’s own packages', () => {
  const lock = {
    packages: {
      '': { name: 'app' },
      'node_modules/react': { version: '19.0.1', license: 'MIT' },
      'node_modules/vite': { version: '7.0.0', license: 'MIT', dev: true },
      'node_modules/@sentinel/ui': { link: true, resolved: '../sentinel-shared/ui' },
      '../sentinel-shared/ui': { version: '0.1.0' },
      'node_modules/@mariner-sentinel/charts': { version: '0.1.0' },
      'node_modules/@esbuild/darwin-arm64': { version: '0.25.0', license: 'MIT', optional: true },
    },
  };
  assert.deepEqual(
    shippedEntries(lock).map((e) => e.name),
    ['react', '@esbuild/darwin-arm64'],
  );
});

test('collect lists each package once, with its licence and notice, sharing identical texts', () => {
  const root = mkdtempSync(join(tmpdir(), 'licences-'));
  try {
    const put = (rel, files) => {
      mkdirSync(join(root, rel), { recursive: true });
      for (const [f, body] of Object.entries(files)) writeFileSync(join(root, rel, f), body);
    };
    put('node_modules/a', { 'package.json': '{}', LICENSE: 'MIT License\nCopyright A' });
    put('node_modules/b', { 'package.json': '{}', 'LICENSE.md': 'MIT License\nCopyright A' });
    put('node_modules/c', { 'package.json': '{"license":"Apache-2.0"}', LICENSE: 'Apache', NOTICE: 'Notice C' });
    put('node_modules/d', { 'package.json': '{}' });
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/a': { version: '1.0.0', license: 'MIT' },
          'node_modules/b': { version: '2.0.0', license: 'MIT' },
          'node_modules/c': { version: '3.0.0' },
          'node_modules/d': { version: '4.0.0', license: 'ISC' },
          'node_modules/x/node_modules/a': { version: '1.0.0', license: 'MIT' },
          'node_modules/gone': { version: '1.0.0', license: 'MIT', optional: true },
        },
      }),
    );
    const file = collect([root]);
    assert.deepEqual(
      file.packages.map((p) => [p.name, p.version, p.license, p.text]),
      [
        ['a', '1.0.0', 'MIT', 0],
        ['b', '2.0.0', 'MIT', 0],
        ['c', '3.0.0', 'Apache-2.0', 1],
        ['d', '4.0.0', 'ISC', -1],
      ],
    );
    assert.equal(file.texts[1], 'Apache\n\nNotice C');
    assert.equal(readLicenceText(join(root, 'node_modules/d')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect refuses a root with no lockfile', () => {
  const root = mkdtempSync(join(tmpdir(), 'licences-'));
  try {
    assert.throws(() => collect([root]), /No package-lock.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packageDirOf finds the installed package a bundled module came from', () => {
  assert.equal(packageDirOf('/a/app/node_modules/react/index.js'), '/a/app/node_modules/react');
  assert.equal(packageDirOf('/a/app/node_modules/@supabase/supabase-js/dist/x.js?v=1'), '/a/app/node_modules/@supabase/supabase-js');
  assert.equal(packageDirOf('/a/app/node_modules/x/node_modules/y/lib/z.js'), '/a/app/node_modules/x/node_modules/y');
  assert.equal(packageDirOf('C:\\a\\app\\node_modules\\leaflet\\dist\\leaflet.js'), 'C:/a/app/node_modules/leaflet');
  assert.equal(packageDirOf('/a/app/src/App.tsx'), null);
  assert.equal(packageDirOf('/a/sentinel-shared/ui/dist/index.js'), null);
  assert.equal(packageDirOf('\0vite/preload-helper'), null);
});

test('licencesPlugin writes the bundle’s packages and the roots’ runtime packages as one asset', () => {
  const root = mkdtempSync(join(tmpdir(), 'licences-'));
  try {
    mkdirSync(join(root, 'node_modules/react'), { recursive: true });
    writeFileSync(join(root, 'node_modules/react/package.json'), '{"name":"react","version":"19.0.1","license":"MIT"}');
    writeFileSync(join(root, 'node_modules/react/LICENSE'), 'MIT License\nCopyright Meta');
    mkdirSync(join(root, 'node_modules/express'), { recursive: true });
    writeFileSync(join(root, 'node_modules/express/package.json'), '{"name":"express","version":"5.1.0"}');
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      packages: {
        'node_modules/express': { version: '5.1.0', license: 'MIT' },
        'node_modules/react': { version: '19.0.1', license: 'MIT', dev: true },
      },
    }));
    const emitted = [];
    const plugin = licencesPlugin({ roots: [root] });
    plugin.generateBundle.call({
      getModuleIds: () => [join(root, 'node_modules/react/index.js'), join(root, 'src/main.tsx')][Symbol.iterator](),
      emitFile: (f) => emitted.push(f),
    });
    assert.equal(plugin.apply, 'build');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].fileName, 'third-party-licenses.json');
    const file = JSON.parse(emitted[0].source);
    assert.deepEqual(file.packages.map((p) => `${p.name}@${p.version}`), ['express@5.1.0', 'react@19.0.1']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
