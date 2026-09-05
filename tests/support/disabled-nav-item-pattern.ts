// Standard MDN-recommended regex-metacharacter escape -- matches the
// existing local copy of this exact idiom in
// tests/architecture/verification-prose-scan.test.ts and
// src/domain/status-vocabulary/labels.test.ts, kept as its own small
// local function here rather than factored into a shared util module
// (matching this codebase's own established convention of small,
// self-contained per-file helpers over a shared utility layer).
function escapeRegExp(
  text: string,
): string {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

/**
 * The accessible-name pattern a disabled sidebar nav item's <button>
 * carries (components/shell/sidebar.tsx's own sr-only " ({reason})"
 * suffix, SidebarSection): the item's label, a space, then its
 * unavailableReason wrapped in LITERAL parentheses, anchored to the
 * whole accessible name.
 *
 * S1 remediation (independent Opus 5 review, S1 finding #1): this used
 * to be built inline in tests/e2e/shell.spec.ts as
 * `new RegExp(\`^${label} \(.+\)$\`)`. Inside a template literal,
 * `\(`/`\)` are not recognized JS escape sequences, so the backslash
 * was silently dropped BEFORE the string ever reached RegExp -- the
 * pattern RegExp actually received was `^${label} (.+)$`, where the
 * unescaped parens open a CAPTURE GROUP rather than matching literal
 * characters, so it matched "Label anything" with no parentheses
 * required at all. The `\\(`/`\\)` around the reason group is the
 * fix for that.
 *
 * S1 remediation, round 2 (fresh Opus 5 review of the round-1 fix,
 * remaining yellow finding #1): `label` itself was still interpolated
 * raw, so a future nav label containing a regex metacharacter could
 * either throw at construction (an unbalanced paren -- a real
 * `SyntaxError`, not hypothetical) or silently under-constrain the
 * match (a literal "." matching any character instead of a literal
 * dot). `escapeRegExp(label)` above makes every character in `label`
 * literal, regardless of what it contains -- proven by
 * tests/support/disabled-nav-item-pattern.test.ts's own metacharacter
 * cases, which fail against the unescaped construction (throw, and a
 * false-positive match) and pass against this one.
 */
export function disabledNavItemNamePattern(
  label: string,
): RegExp {
  return new RegExp(
    `^${escapeRegExp(label)} \\(.+\\)$`,
  );
}
