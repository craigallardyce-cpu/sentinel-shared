/**
 * The package is "type": "module", which makes Node treat every .js file under it as ESM —
 * including the CommonJS output in dist-cjs/, whose require() calls then fail at load.
 *
 * Dropping a package.json into that directory scopes it back to CommonJS. It is generated
 * here rather than committed so it cannot be lost to a clean checkout or a stray rm -rf.
 */
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('dist-cjs', { recursive: true });
writeFileSync('dist-cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
console.log('[build] scoped dist-cjs to commonjs');
