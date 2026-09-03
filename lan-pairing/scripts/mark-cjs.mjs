/*
  Mark dist-cjs/ as CommonJS.

  The package itself is `"type": "module"`, which applies to every .js file
  underneath it -- including the CommonJS output. Without this marker Node reads
  dist-cjs/index.js as ESM, and a `require()` of the package resolves to an empty
  object rather than failing loudly: HarborSentinel's server bundle is CJS and
  would have started, imported nothing, and thrown on the first call.

  @sentinel/settings carries the same file. Generated here rather than committed
  and hoped for, so a clean build cannot lose it.
*/
import { writeFileSync } from 'node:fs';

writeFileSync(
  new URL('../dist-cjs/package.json', import.meta.url),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);
