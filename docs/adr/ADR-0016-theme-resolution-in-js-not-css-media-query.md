# ADR-0016: Resolve light/dark theme in JS before paint, not via a CSS media-query fallback

## Status

Accepted

## Context

The original theme architecture (per `docs/plans/MASTER_PLAN.md` §26 /
the artifact-design conventions this project started from) used three
CSS blocks: a bare `:root {}` for light defaults, an explicit
`:root[data-theme="dark"] {}` for a user's forced choice, and
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`
so the OS preference applied automatically *without* JavaScript ever
needing to touch `data-theme` for the common "just follow the system"
case.

Verifying the Phase 2 design gallery in a live rendered browser (WCAG
contrast checks against the actual page, not estimated -- see
ADR-0015) surfaced a second, unrelated defect: setting
`data-theme="light"` -- via the real theme-toggle button, not just
script manipulation -- never actually produced light-themed output.
`getComputedStyle` confirmed the custom property `--surface-page`
correctly resolved to the light value at the `:root` level, and the
compiled CSS (fetched and inspected directly) faithfully matched the
source with no build-tool mangling, yet every element's actual
rendered background/text color stayed on dark-theme values regardless
of the `data-theme` attribute. The `:not([data-theme="light"])`-inside-`@media`
pattern did not reliably invalidate/reapply in this project's actual
rendering environment, for reasons not fully isolated (possibly an
interaction specific to the automation/headless context used for
verification, possibly a real engine quirk with this selector
combination) -- and regardless of root cause, a mechanism this hard to
diagnose is not something to ship load-bearing UI behavior on.

## Decision

Stop deriving theme from CSS at all. `app/layout.tsx`'s inline
before-paint script now resolves a previously-stored choice
(`localStorage`) **or** `window.matchMedia("(prefers-color-scheme: dark)").matches`
into a concrete `"light"` or `"dark"` string, and always sets
`data-theme` to that value -- never leaves it absent. `app/globals.css`
correspondingly drops the `@media (prefers-color-scheme: dark)` block
entirely, keeping only two unconditional blocks: bare `:root {}`
(light) and `:root[data-theme="dark"]` (dark). There is exactly one
source of truth for "which theme is this" (the attribute), determined
once, in one place, before first paint.

This also matches the theming approach used by `next-themes` (the
de-facto standard Next.js theming library) and shadcn/ui's own
templates: resolve once in JS, keep CSS declarative and two-valued.

## Alternatives considered

- **Debug the `:not()`-in-`@media` pattern further** (try
  `:where()`, reorder the blocks, add `!important`, test outside the
  MCP browser automation context to rule out an environment-specific
  quirk) -- not pursued: even if a further-tweaked version of the
  pattern could be found to work, it would still carry two sources of
  truth (CSS-derived-from-media-query vs. JS-driven explicit
  override) for the same piece of state, which is the more fundamental
  thing worth removing regardless of whether a workaround exists.
- **Keep the media-query pattern for the "no JS" case** (progressive
  enhancement) -- rejected: this is a Next.js application; JS is
  already required for hydration, routing, and every interactive
  surface. There is no meaningfully JS-free rendering path to protect.

## Consequences

Any future author adding theme-dependent tokens only ever needs to
add a bare `:root {}` entry and a `:root[data-theme="dark"] {}`
override -- no third media-query block, and no need to reason about
`:not()` selector interactions. `components/shell/theme-toggle.tsx`'s
existing mount-time read of `data-theme` (with a `"light"` fallback if
somehow absent) required no change -- it will now always read a
concrete value set by the layout's init script.
