#!/usr/bin/env node

/**
 * Where a build writes, and whether it carries the E2E rate-limit
 * bypass, are ONE decision made in ONE place.
 *
 * 2026-09-03 (P14). Background, because the reasoning is the point.
 *
 * src/infrastructure/rate-limit/rate-limiter.ts guards the E2E bypass
 * behind two keys: a BUILD-TIME one, inlined by next.config.ts's `env`
 * block, and a runtime one. Both must be "true". The build-time key
 * exists so that no runtime environment variable can revive the bypass
 * on a production build -- that was a deliberate P13 security fix and
 * nothing here weakens it.
 *
 * What went wrong is downstream of that. The Playwright harness builds
 * a REAL production build with the bypass enabled (its webServer
 * command is `pnpm build && ...`), and that build landed in the same
 * `.next` a deploy would use. So running the test suite left a
 * bypass-carrying artifact sitting in the deployable directory. Nothing
 * ever shipped from it -- the Dockerfile builds from source inside the
 * image and .dockerignore excludes `.next` -- but "nothing shipped"
 * is a property of the current deploy path, not an invariant.
 *
 * The fix makes it an invariant: a build that bakes the bypass writes
 * somewhere else. The bypass and the deployable directory are now
 * mutually exclusive BY CONSTRUCTION rather than by convention.
 *
 * That also buys a fail-closed property worth more than the tidiness.
 * The Dockerfile copies `.next/standalone` by a hardcoded path. A
 * bypass build produces no `.next` at all, so the COPY fails outright
 * instead of quietly shipping a server with rate limiting disabled.
 * Do not "tidy" that hardcoded path into this resolver.
 *
 * WHY THE VARIABLE NAME MATTERS. There are two names in play and they
 * are not interchangeable:
 *
 *   NEXT_PUBLIC_E2E_RATE_LIMIT_BYPASS_BUILD  -- the INPUT. Set in the
 *     process environment by playwright.config.ts's webServer.env. This
 *     is the one to read here.
 *
 *   E2E_RATE_LIMIT_BYPASS_BUILD              -- the OUTPUT. The key
 *     next.config.ts's `env` block emits, which exists only as an
 *     inlined literal inside the compiled bundle. It is NEVER set in
 *     the process environment, so reading it here would silently always
 *     be false and this whole mechanism would be a no-op that still
 *     let every gate pass.
 *
 * That mistake was made in the first draft of this fix and caught in
 * review. It is called out here so it is not made again.
 */

export const E2E_BYPASS_ENV_VAR =
  "NEXT_PUBLIC_E2E_RATE_LIMIT_BYPASS_BUILD";

export const PRODUCTION_DIST_DIR =
  ".next";

export const E2E_DIST_DIR =
  ".next-e2e";

/**
 * Exact string "true" only -- matching rate-limiter.ts's own comparison
 * byte for byte, so "TRUE", "1" and "yes" all mean a normal,
 * deployable build. A looser test here than in the rate limiter would
 * put a build in the E2E directory while still shipping it a
 * production-shaped bypass flag.
 */
export function isE2eBypassBuild(
  env = process.env,
) {
  return env[E2E_BYPASS_ENV_VAR] === "true";
}

export function resolveDistDir(
  env = process.env,
) {
  return isE2eBypassBuild(env)
    ? E2E_DIST_DIR
    : PRODUCTION_DIST_DIR;
}
