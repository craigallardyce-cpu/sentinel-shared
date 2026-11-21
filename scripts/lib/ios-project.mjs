// Readers for the two files of a Capacitor iOS project that the drift checker
// holds to the fleet's rules (check-fleet-drift.mjs, section 6b). Both are read
// as text: an Info.plist is XML and a project.pbxproj an old-style plist, and the
// handful of keys checked are simple enough that a parser would add a
// dependency for nothing.

/** The strings of an array-valued key in an XML Info.plist, or null if absent. */
export function plistArray(src, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\~]/g, '\\$&');
  const m = src.match(new RegExp(`<key>${escaped}</key>\\s*<array>([\\s\\S]*?)</array>`));
  return m ? [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]) : null;
}

/** The string value of a key in an XML Info.plist, or null if absent. */
export function plistString(src, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\~]/g, '\\$&');
  const m = src.match(new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`));
  return m ? m[1] : null;
}

/** Every distinct value a build setting takes across a project.pbxproj's configurations. */
export function pbxSettings(src, name) {
  const re = new RegExp(`\\b${name} = "?([^";]+)"?;`, 'g');
  return [...new Set([...src.matchAll(re)].map((m) => m[1]))];
}
