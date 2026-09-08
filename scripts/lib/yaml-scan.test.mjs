import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripYamlComments, findCheckoutRef } from './yaml-scan.mjs';

/*
  The shape every case below is cut from: the shared checkout as the three apps'
  build.yml actually writes it, pinned to a SHA.
*/
const checkout = (body) => `
jobs:
  build:
    steps:
      - name: Check out the app
        uses: actions/checkout@v5

      - name: Check out sentinel-shared
        uses: actions/checkout@v5
        with:
${body}
      - name: Setup Node.js
        uses: actions/setup-node@v5
`;

test('finds a pin sitting directly under the repository', () => {
  const wf = checkout(`          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
          ref: f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), 'f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90');
});

/*
  The regression this module exists for. The old rule matched `ref:` only within
  400 characters of `repository:`, so this workflow -- correctly pinned --
  reported "shared checkout is not pinned to a SHA" purely because somebody
  explained why the pin was there. Found while bumping HarborSentinel's pin and
  worked around by deleting most of the comment.
*/
test('a long comment between repository and ref does not hide the pin', () => {
  const wf = checkout(`          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
          # Pinned deliberately: a release must build against the shared code it was
          # tested with, rather than whatever main happens to be when the tag is cut.
          # Bump this in all three apps together whenever a shared package changes,
          # and only ever to a commit that is published on origin/main -- a pin that
          # exists only locally produces no build at all, in all three apps at once.
          # See sentinel-shared/CLAUDE.md, "Releasing", step 3.
          ref: f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), 'f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90');
});

test('a ref named only inside a comment is not read as a pin', () => {
  const wf = checkout(`          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
          # ref: 1111111111111111111111111111111111111111 was the previous pin
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), null);
});

test('an unpinned shared checkout returns null', () => {
  const wf = checkout(`          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), null);
});

/*
  Containment, not distance. A `ref:` belonging to a different checkout step is
  not this step's pin however close it sits -- the failure a pure proximity
  match would still have, in the opposite direction to the one above.
*/
test('a later step\'s ref is not attributed to the shared checkout', () => {
  const wf = `
jobs:
  build:
    steps:
      - name: Check out sentinel-shared
        uses: actions/checkout@v5
        with:
          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
      - name: Check out the charts fixtures
        uses: actions/checkout@v5
        with:
          repository: craigallardyce-cpu/chart-fixtures
          ref: 2222222222222222222222222222222222222222
`;
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), null);
});

test('a pin written above the repository is still found', () => {
  const wf = checkout(`          ref: f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90
          repository: craigallardyce-cpu/sentinel-shared
          path: sentinel-shared
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), 'f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90');
});

/*
  A branch is pinned to something, just not to a SHA. The old regex only ever
  matched hex, so it reported this identically to no pin at all; the caller can
  now tell the two apart and say which mistake was made.
*/
test('a branch ref is returned rather than silently discarded', () => {
  const wf = checkout(`          repository: craigallardyce-cpu/sentinel-shared
          ref: main
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), 'main');
});

test('quotes around the ref are stripped', () => {
  const wf = checkout(`          repository: "craigallardyce-cpu/sentinel-shared"
          ref: "f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90"
`);
  assert.equal(findCheckoutRef(wf, 'sentinel-shared'), 'f746bc3aa1b2c3d4e5f60718293a4b5c6d7e8f90');
});

test('a hash inside a quoted scalar is data, not a comment', () => {
  assert.equal(stripYamlComments('  name: "Build #3"'), '  name: "Build #3"');
  assert.equal(stripYamlComments("  name: 'a # b'  # trailing"), "  name: 'a # b'");
});

test('stripping comments preserves line count and indentation', () => {
  const src = 'a: 1\n  # note\nb: 2\n';
  assert.equal(stripYamlComments(src).split('\n').length, src.split('\n').length);
  assert.equal(stripYamlComments('    key: v # why').indexOf('key'), 4);
});

test('a hash that does not follow whitespace stays put', () => {
  assert.equal(stripYamlComments('  url: https://example.test/x#frag'), '  url: https://example.test/x#frag');
});
