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
 * required at all. The `\\(`/`\\)` below is the fix: a template
 * literal's `\\` produces one literal backslash in the resulting
 * string, which RegExp then correctly reads as an escaped literal
 * parenthesis -- proven by tests/support/disabled-nav-item-pattern.test.ts,
 * which fails against the unescaped construction (2 of 4 cases) and
 * passes against this one.
 */
export function disabledNavItemNamePattern(
  label: string,
): RegExp {
  return new RegExp(
    `^${label} \\(.+\\)$`,
  );
}
