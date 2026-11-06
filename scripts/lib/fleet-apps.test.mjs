import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalAppName, findAppDir } from './fleet-apps.mjs';

test('canonicalAppName maps any letter case to the GitHub spelling and leaves others alone', () => {
  assert.equal(canonicalAppName('harborsentinel'), 'HarborSentinel');
  assert.equal(canonicalAppName('OCEANSENTINEL'), 'OceanSentinel');
  assert.equal(canonicalAppName('VesselKeeper'), 'VesselKeeper');
  assert.equal(canonicalAppName('marinersentinel-website'), 'marinersentinel-website');
});

test('findAppDir finds either spelling, prefers the exact one, and needs a package.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-apps-'));
  try {
    const mk = (dir, withPkg = true) => {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      if (withPkg) fs.writeFileSync(path.join(root, dir, 'package.json'), '{}');
    };
    assert.equal(findAppDir(root, 'HarborSentinel'), null);

    mk('harborsentinel');
    assert.equal(findAppDir(root, 'HarborSentinel'), path.join(root, 'harborsentinel'));

    // An exact folder wins wherever both exist (a case-sensitive file system).
    if (!fs.existsSync(path.join(root, 'HarborSentinel'))) {
      mk('HarborSentinel');
      assert.equal(findAppDir(root, 'HarborSentinel'), path.join(root, 'HarborSentinel'));
    }

    // A folder with no package.json is not a checkout.
    mk('oceansentinel', false);
    assert.equal(findAppDir(root, 'OceanSentinel'), null);

    assert.equal(findAppDir(path.join(root, 'missing'), 'VesselKeeper'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
