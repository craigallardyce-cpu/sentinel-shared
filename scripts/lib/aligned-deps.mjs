/**
 * Cross-app dependency alignment against a published canonical set.
 *
 * The checker used to find a split in ALIGNED_DEPS (two Reacts, a Capacitor on
 * one app only) by comparing the apps with each other, so it ran only when more
 * than one app was checked out -- never in an app's CI, where exactly one is.
 * fleet-dependencies.json in this repo publishes the range the fleet uses for
 * each aligned package, so an app can be compared against it alone, the same
 * way fleet-version.json made version alignment run per-push.
 *
 * Everything here is pure: the checker does the file reading and passes in
 * declarations, which is what lets these rules be unit tested.
 */

/**
 * Every declaration of an aligned package in one parsed package.json.
 * dependencies and devDependencies are read separately, so a package declared
 * in both with different ranges is two declarations, not one that silently won.
 */
export function declarationsIn(pkg, { app, file, alignedDeps }) {
  const out = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg?.[field] || {};
    for (const dep of alignedDeps) {
      if (typeof deps[dep] === 'string') out.push({ app, file, field, dep, range: deps[dep] });
    }
  }
  return out;
}

/**
 * Group declarations by package and range. Returns
 * Map(dep -> Map(range -> [declaration])), in first-seen order.
 */
export function rangesByDep(decls) {
  const seen = new Map();
  for (const d of decls) {
    if (!seen.has(d.dep)) seen.set(d.dep, new Map());
    const byRange = seen.get(d.dep);
    if (!byRange.has(d.range)) byRange.set(d.range, []);
    byRange.get(d.range).push(d);
  }
  return seen;
}

/**
 * Declarations whose range differs from the published one, or whose package
 * has no published range at all. Packages published but not declared are not
 * reported here -- an app need not use every aligned package (VesselKeeper
 * declares no `motion`), and only a full-fleet run can say an entry is unused.
 */
export function compareWithPublished(decls, published) {
  const out = [];
  for (const d of decls) {
    const want = Object.prototype.hasOwnProperty.call(published, d.dep) ? published[d.dep] : undefined;
    if (want === undefined) out.push({ ...d, kind: 'unpublished' });
    else if (want !== d.range) out.push({ ...d, kind: 'mismatch', published: want });
  }
  return out;
}

/**
 * Published entries that are not in ALIGNED_DEPS at all. Wrong in any scope:
 * the checker never reads them, so the file would promise a guard that is not
 * there.
 */
export function unknownEntries(published, alignedDeps) {
  return Object.keys(published).filter((dep) => !alignedDeps.includes(dep));
}

/**
 * The canonical set the declarations agree on, for regenerating the file.
 * Returns { dependencies, conflicts }: dependencies in ALIGNED_DEPS order, and
 * conflicts as [dep, Map(range -> [declaration])] for every package declared
 * with more than one range. A caller must refuse to write while conflicts exist
 * -- publishing one side of a split would make the other side fail everywhere
 * without anyone having decided which is right.
 */
export function canonicalFrom(decls, alignedDeps) {
  const grouped = rangesByDep(decls);
  const dependencies = {};
  const conflicts = [];
  for (const dep of alignedDeps) {
    const byRange = grouped.get(dep);
    if (!byRange) continue;
    if (byRange.size > 1) conflicts.push([dep, byRange]);
    else dependencies[dep] = [...byRange.keys()][0];
  }
  return { dependencies, conflicts };
}
