/**
 * Where the fleet's app checkouts are, whatever their folder is called.
 *
 * Craig's PC and every CI workflow check the apps out under their GitHub
 * spelling (`HarborSentinel`), but a cloud session clones each one under its
 * lower-case remote name (`harborsentinel`). On Linux those are different
 * folders, so anything that joined the fleet root with the exact name found no
 * apps there: verify-clean.mjs copied a lower-case clone under a name the drift
 * checker could not see (sentinel-shared #118), and a bare run of the drift
 * checker from a cloud session reported "No Sentinel apps found" and checked
 * nothing (roadmap #108). Both now resolve names through here.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The app folder names check-fleet-drift.mjs looks for beside sentinel-shared. */
export const FLEET_APP_NAMES = ['HarborSentinel', 'OceanSentinel', 'VesselKeeper'];

/**
 * The GitHub spelling of a fleet app's folder name, matched case-insensitively
 * (`harborsentinel` -> `HarborSentinel`), or the name unchanged if it is not one.
 */
export function canonicalAppName(name) {
  return FLEET_APP_NAMES.find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
}

/**
 * The checkout of app `name` directly under `root`, or null if there is none.
 * A folder counts only if it holds a package.json. The exact spelling wins, so
 * a machine that has both keeps reading the one CI would; otherwise the first
 * folder whose name matches case-insensitively, in sorted order.
 */
export function findAppDir(root, name) {
  const exact = path.join(root, name);
  if (fs.existsSync(path.join(exact, 'package.json'))) return exact;
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  const match = entries
    .filter((n) => n.toLowerCase() === name.toLowerCase())
    .sort()
    .find((n) => fs.existsSync(path.join(root, n, 'package.json')));
  return match ? path.join(root, match) : null;
}
