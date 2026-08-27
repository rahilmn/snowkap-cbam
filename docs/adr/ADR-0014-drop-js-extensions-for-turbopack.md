# ADR-0014: Drop mandatory `.js` extensions on relative imports (Turbopack incompatibility)

## Status

Accepted. Amends one specific rule from
[ADR-0002](./ADR-0002-single-package-layered-architecture.md); the rest
of that ADR (single-package layering, no path aliases, layers as
folders not packages) is unaffected and remains in force.

## Context

ADR-0002 established two standing conventions to keep a future
workspace split mechanical: relative imports always use `.js`
extensions (matching TypeScript's `NodeNext` module resolution, which
Node's real ESM loader requires for `"type": "module"` packages), and
no `tsconfig.json` path aliases anywhere. All of Phase 1's code
followed this consistently.

While wiring Phase 2's first real cross-layer import — `app/api/health/route.ts`
importing `getSupabaseClient` from `src/infrastructure/supabase/client.ts`
— `next build` (Turbopack, Next.js 16's default bundler) failed with
`Module not found` for every `.js`-suffixed relative import it had to
resolve, including ones pointing at plain `.ts` files, not just
`.tsx` ones. Investigation confirmed: unlike `tsc` under `NodeNext`
resolution and unlike Vite/esbuild (which vitest uses, and which is
why the existing test suite never surfaced this), Turbopack does not
perform the "`.js` specifier resolves to a `.ts`/`.tsx` source file"
substitution. Next.js exposes `turbopack.resolveExtensions` (which
extensions to *try* when a specifier is extension-*less*) but nothing
equivalent to webpack's `resolve.extensionAlias` (which would let a
literal `.js` specifier resolve to a `.ts` file) for Turbopack.

This is not a one-off inconvenience confined to Phase 2: Phase 5
explicitly wires `app/` into `resolveActiveDefaultValue` and the
regulatory resolution chain, so the incompatibility would recur --
and worsen -- as more of `src/` becomes reachable from `app/`.

## Decision

Drop the `.js`-extension requirement. Relative imports throughout the
codebase (`src/`, `tests/`, `app/`, `components/`, `lib/`) are now
extension-less (`from "./types"`, not `from "./types.js"`). `tsconfig.json`
moved from `module: "NodeNext"` / `moduleResolution: "NodeNext"` to
`module: "preserve"` / `moduleResolution: "bundler"` -- the pairing
TypeScript's own documentation recommends for bundler-based toolchains,
and empirically verified (before this change was applied) to resolve
every previously-`.js`-suffixed import correctly with zero new
typecheck errors elsewhere in the codebase.

The change was applied as a single mechanical, project-wide find/replace
on import specifiers only (`from "(\.\.?/[^"]*)\.js"` -> `from "\1"`)
-- verified by diff review to touch nothing but that one string pattern
in every file it changed, including the protected regulatory files
(`src/domain/regulatory/resolve-default-value.ts` gets exactly one
changed line: its own single relative import's extension). Landed as
its own isolated commit per
[ADR-0005](./ADR-0005-protected-regulatory-subsystem.md)'s protected-zone
policy, with full gate evidence (`pnpm typecheck`, `pnpm test` at
127/127 credentialed, `pnpm regulatory:verify` RESULT: VALID) captured
before and after.

ADR-0002's other two commitments are unchanged and still hold: the
domain/application/infrastructure layers stay folders in one package
(not a pnpm workspace), and no `tsconfig.json` path aliases are
introduced -- `app/`/`components/` code uses ordinary relative imports,
not `@/*`-style aliases, even though that is the more common Next.js/
shadcn convention. `tests/architecture/layering.test.ts` required no
changes: its rule engine already handled extension-less specifiers
(it strips a trailing `.js` if present, a no-op when absent), and it
re-confirmed zero layering violations after this change.

## Alternatives considered

- **Force webpack instead of Turbopack** (`next build --webpack` /
  removing Turbopack), then set `webpack.resolve.extensionAlias`.
  Rejected: fights the framework's own stated direction (Turbopack is
  Next.js 16's default and the path forward); trades one narrow
  incompatibility for a standing deviation from upstream defaults that
  would need re-litigating every Next.js upgrade.
- **Keep `.js` only in `src/`, extension-less only in `app/`/`components/`.**
  Rejected once investigation showed the failures weren't confined to
  files *authored* in `app/` -- they hit any file Turbopack had to
  traverse into, including plain `.ts` files under `src/infrastructure/`.
  A split convention would still break the moment `app/` code imports
  deeper into `src/domain/regulatory/` (Phase 5), just later and with
  more code already committed under the now-wrong convention.
- **A Turbopack alias-per-file workaround** (`turbopack.resolveAlias`
  entries mapping each `.js` specifier to its real file). Rejected:
  does not scale, needs manual upkeep per new file, and is more
  fragile than fixing the actual specifiers.

## Consequences

New code across the whole repository should use extension-less relative
imports going forward -- CLAUDE.md is updated to say so. `tsx` (still a
devDependency, used for any future script that runs TypeScript directly
via Node's real ESM loader rather than through Vite or Turpoback) would
still require explicit extensions if invoked directly on a `.ts` file
with a relative extension-less import; no current script does this, so
no immediate impact, but this is worth remembering if one is added later.
