/**
 * Structural scanning for the workflow files the drift checker reads.
 *
 * The checker used to find a checkout's pinned SHA with a character window --
 * `repository:[\s\S]{0,400}?ref:` -- which is wrong in the direction that hurts
 * most: it reports a correctly pinned workflow as unpinned as soon as somebody
 * writes a long enough comment above `ref:`. That happened while bumping
 * HarborSentinel's pin, and was worked around by shortening the comment, which
 * is the rule training the author rather than the author fixing the rule.
 *
 * It is the third time a fixed-width lookback in this checker has been defeated
 * in the same way, so the fix here is the class rather than the instance: strip
 * comments first, then match within the YAML block the key actually belongs to.
 * Distance in characters is never the question being asked; containment is.
 */

/**
 * Remove `#` comments, keeping every line and column so that positions and
 * indentation still line up with the original text.
 *
 * Quote-aware, because a `#` inside a scalar is data, not a comment -- a pinned
 * ref is unlikely to contain one, but a `name:` or a URL elsewhere in the block
 * can, and a naive strip would swallow the rest of that line and any `ref:` on
 * it. YAML also only starts a comment at a `#` that begins a line or follows
 * whitespace: `path#fragment` is a scalar.
 */
export function stripYamlComments(text) {
  return text.split('\n').map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quote) {
        // Only single quotes escape, by doubling; YAML double quotes use backslash.
        if (ch === '\\' && quote === '"') { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i).replace(/\s+$/, '');
      }
    }
    return line;
  }).join('\n');
}

const indentOf = (line) => line.match(/^[ \t]*/)[0].length;
const isBlank = (line) => line.trim() === '';

/**
 * The value of `key` within the same YAML mapping block as `anchorLine`.
 *
 * A block is the run of lines at the anchor's own indentation, plus anything
 * nested deeper. It ends at the first non-blank line indented less, or at the
 * next sibling list item -- which is what stops a later checkout step's `ref:`
 * being read as this one's.
 */
function valueInBlock(lines, anchorIndex, key) {
  const anchorIndent = indentOf(lines[anchorIndex]);
  const pattern = new RegExp(`^[ \\t]*${key}\\s*:\\s*(.+?)\\s*$`);

  // A mapping entry can precede as well as follow its siblings, so scan the
  // whole block outward from the anchor rather than only forward: `ref:` above
  // `repository:` is unusual but valid, and was silently unsupported before.
  const bounds = [anchorIndex, anchorIndex];
  for (let i = anchorIndex - 1; i >= 0; i -= 1) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) < anchorIndent || /^[ \t]*-\s/.test(lines[i])) break;
    bounds[0] = i;
  }
  for (let i = anchorIndex + 1; i < lines.length; i += 1) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) < anchorIndent || /^[ \t]*-\s/.test(lines[i])) break;
    bounds[1] = i;
  }

  for (let i = bounds[0]; i <= bounds[1]; i += 1) {
    const m = pattern.exec(lines[i]);
    // Only a sibling of the anchor, never a key nested inside some deeper map.
    if (m && indentOf(lines[i]) === anchorIndent) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

/**
 * The `ref:` of the `actions/checkout` step that checks out `repoName`, or null
 * when the workflow checks it out without pinning one.
 *
 * Returns the raw string rather than a SHA so that the caller can tell "pinned
 * to a branch" apart from "not pinned at all" -- two different mistakes that
 * the old regex, which only ever matched hex, reported identically.
 */
export function findCheckoutRef(workflowText, repoName) {
  const lines = stripYamlComments(workflowText).split('\n');
  const anchor = new RegExp(`^[ \\t]*repository\\s*:\\s*['"]?\\S*${repoName}['"]?\\s*$`);

  for (let i = 0; i < lines.length; i += 1) {
    if (anchor.test(lines[i])) {
      const ref = valueInBlock(lines, i, 'ref');
      if (ref) return ref;
    }
  }
  return null;
}
