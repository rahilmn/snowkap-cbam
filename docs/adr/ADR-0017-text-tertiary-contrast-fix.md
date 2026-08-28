# ADR-0017: Fix WCAG AA contrast failure in `--text-tertiary`

## Status

Accepted

## Context

ADR-0015 recomputed every status/badge/button color pairing directly
against the WCAG relative-luminance formula and fixed everything it
checked. It did not check `--text-tertiary`, which by that point was
defined (`neutral-400` light / `neutral-500` dark) but not yet used
anywhere real. Phase 2 went on to use it in three places: the `/design`
gallery's color-swatch captions (`app/design/page.tsx`), the
command-palette trigger's "Search…" label
(`components/shell/command-palette-trigger.tsx`), and the " CBAM"
suffix of the topbar wordmark (`components/shell/wordmark.tsx`).

An independent multi-dimensional review of the Phase 2 diff (a
dedicated accessibility pass, adversarially verified) recomputed
contrast for all three real usages and found every one of them below
AA's 4.5:1 minimum for normal-size text:

- Light mode (`neutral-400` `#91919a`): 2.92:1 against `surface-page`
  (`neutral-50`), 2.67:1 against `surface-sunken`/`surface-inset`
  (`neutral-100`), 3.13:1 against `surface-raised` (white).
- Dark mode (`neutral-500` `#6b6b73`): 3.75:1 against `surface-page`
  (`neutral-950`), 3.42:1 against `surface-raised`/`surface-overlay`
  (`neutral-900`), 3.01:1 against `surface-sunken`/`surface-inset`
  (`neutral-800`).

None of the three real usages are decorative or otherwise exempt
(swatch captions and the search label are ordinary readable text, not
a logotype or disabled-control text) -- this directly contradicts
`app/globals.css`'s own header claim that every token below it is
AA-verified. Independently recomputed (Node script, same
relative-luminance formula, not trusted from the review alone) and
confirmed exact: all six ratios above matched to three decimal places.

## Decision

Replace `--text-tertiary` in both themes with a value that clears
4.5:1 with real margin against every surface it is actually paired
with (`surface-page`, `surface-sunken`/`surface-inset`,
`surface-raised`/`surface-overlay`), found by searching the neutral
gray axis for the darkest/lightest usable step rather than nudging by
hand:

- **Light**: `#61616a` (not a named ramp step -- see below). 5.73:1
  against `surface-page`, 5.25:1 against `surface-sunken`/
  `surface-inset`, 6.13:1 against `surface-raised`/`surface-overlay`.
- **Dark**: `#93939c` (not a named ramp step). 6.50:1 against
  `surface-page`, 5.92:1 against `surface-raised`/`surface-overlay`,
  5.22:1 against `surface-sunken`/`surface-inset`.

Both values fall between the existing `-500`/`-600` (light) and
`-300`/`-400` (dark) ramp steps -- reusing an existing named step
either failed AA (the next step out) or was indistinguishable from
`--text-secondary` (the next step in, which already passes AA with a
large margin: 7.4-8.6:1 light, and equivalently for dark's
`neutral-300`). `--text-tertiary` is therefore defined as a direct hex
value rather than `var(--color-neutral-XXX)`, with an inline comment
explaining why, matching the existing precedent for `--accent-brand`
(ADR-0015) diverging from a plain ramp reference when the ramp itself
doesn't have the right step.

## Alternatives considered

- **Reuse `--text-secondary`'s value for `--text-tertiary`** --
  rejected: passes AA trivially but eliminates the visual hierarchy
  the "tertiary" tier exists to provide (secondary and tertiary text
  would render identically).
- **Add new named ramp steps** (e.g. `neutral-450`, `neutral-550`) --
  rejected as unnecessary ramp expansion for a single token; a direct
  hex value with an explanatory comment is more honest about this
  being a deliberately off-ramp, contrast-driven correction, not a
  general-purpose new shade.
- **Leave it failing and fix per-usage instead of at the token level**
  -- rejected: the failure is in the token, not any specific consumer;
  fixing three call sites independently would drift the moment a
  fourth usage is added, and would not fix the `/design` gallery's own
  documentation of the (currently false) claim that this token is
  AA-verified.

## Consequences

Any *new* text-color token must be contrast-checked against every
surface it will actually be paired with before being treated as done,
not just plausible-looking against one surface it happens to be
authored next to -- this is the same lesson ADR-0015 drew for
status/badge colors, now extended to plain text tiers. No component
code changed; all three real usages inherit the fix automatically
through the token.
