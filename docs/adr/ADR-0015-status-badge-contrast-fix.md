# ADR-0015: Fix WCAG AA contrast failures in the status/badge/button color tokens

## Status

Accepted

## Context

While validating the Phase 2 design-system gallery (`/design`) in a
live rendered browser, a direct contrast check (WCAG 2.1 formula,
computed against the page's actual rendered colors, not estimated)
found several token pairings below AA's 4.5:1 minimum for normal-size
text:

- The primary button (white text on `--accent-brand`) measured 3.14:1
  in dark mode. Even the verified real brand color, `brand-600`
  (`#DF5900`), only reaches 3.77:1 with white text -- below AA in
  *both* themes, since the button used it as a fill in light mode too.
- Every regulatory-status badge except "fallback" failed in light mode
  (success 2.98:1, warning 2.57:1, danger 3.71:1) -- the badges used
  each hue's `-600` tier as text against its own pale `-100` surface,
  which is not enough separation.
- In dark mode, the badges used a translucent 18%-opacity tint of the
  *same* hue as the text, composited over the near-black page. This
  measured 3.11:1 -- and is fundamentally the wrong direction: raising
  the tint's opacity moves the background *toward* the text's own
  color, which *lowers* contrast further, not raises it.
- The dark-mode "unavailable" status (`neutral-500` on `neutral-800`)
  measured 3.01:1.

## Decision

Recompute every text/surface pairing directly (WCAG relative-luminance
formula) and replace values until each measured >= 4.5:1 against its
*exact* paired surface, verified live in the browser rather than
estimated:

- **Buttons**: `--accent-brand` moves from `brand-600`/`brand-500`
  (light/dark) to `brand-700` in both themes (5.23:1 with white text)
  with `brand-800` on hover (7.63:1). `brand-600`, the verified real
  Snowkap orange, remains correct for large-scale/non-text brand
  moments (WCAG's non-text/large-text threshold is 3:1, which it
  clears) — it is simply not usable as small filled-button text
  contrast.
- **Status badges — light mode**: text moves from each hue's `-600`
  tier to a darkened `-700` tier against the unchanged pale `-100`
  surface (success 5.63:1, warning 4.77:1 after a small `-700` hex
  adjustment, danger 6.11:1, interactive/fallback 7.09:1).
- **Status badges — dark mode**: abandons the same-hue translucent
  tint entirely. Text moves to a new lightened `-300` tier per hue
  (success 7.20:1, warning 8.09:1, danger 5.36:1, interactive 5.58:1),
  paired with a flat `--color-neutral-800` surface (matching
  `--surface-inset`) instead of a tint -- simpler and the pairing that
  was actually measured, rather than an opacity composite that shifts
  with whatever page background sits behind it.
- **Dark-mode "unavailable"**: text moves from `neutral-500` to
  `neutral-400` (5.09:1 against `neutral-800`).

New palette rungs added to support this: `--color-success-300`,
`--color-warning-300`, `--color-danger-300`, `--color-interactive-300`
(the dark-mode text tier), plus a small hex adjustment to the existing
`--color-warning-700` (`#92660a` -> `#8d6103`) to clear 4.5:1 with a
safe margin rather than landing at 4.45:1.

`--accent-interactive` is documented as text-only usage (links,
informational icons) -- it is never used as a filled background with
light text, which is what would have required the same brand/button
treatment.

A live re-check after applying the above found one more failure the
initial pass missed: the generic `Badge` component's `brand` tone
(`components/ui/badge.tsx`) paired `brand-700` text on the `brand-100`
surface at 4.38:1 -- just under AA. Moved to `brand-800` (6.38:1).

## Alternatives considered

- **Raise the dark-mode tint's opacity** to compensate for low
  contrast -- rejected once the math showed this moves the composited
  background *toward* the text's own hue (same-color tint), which
  reduces contrast as opacity increases. The direction was backwards.
- **Use a single "one-size" text tier across all four status hues** --
  rejected: warning in particular needed a different darkening amount
  than success/danger/interactive to clear 4.5:1 with any margin
  (`#92660a` and even `#986803` fell short; `#8d6103` was the value
  that actually passed with headroom). Verified per-hue rather than
  assumed uniform.
- **Leave badges failing and fix "later"** -- rejected: the
  "REFERENCE_REQUIRED"/status-honesty badges are the design's own
  stated signature element (`docs/plans/MASTER_PLAN.md` §25); shipping
  them inaccessible in their first phase undermines the specific thing
  they exist to communicate clearly.

## Consequences

Any *new* status/semantic color usage must be contrast-checked against
its actual paired surface before being treated as done -- "looks fine"
is not sufficient, as this defect was invisible without computing it.
The generic `Badge` component (`components/ui/badge.tsx`) already used
the `-700` text tier by original design and required no code change,
only the underlying `warning-700` hex adjustment it inherits.
