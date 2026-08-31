/**
 * The deployed commit SHA, for deployment provenance
 * (docs/plans/MASTER_PLAN.md §32: "Deployment visibility: GIT_SHA in
 * footer/status").
 *
 * Exists because of a real production observation (2026-08-31): after
 * `GIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}` was added to the Railway service,
 * the live `/api/health` reported `git_sha: ""` -- an EMPTY string, rather
 * than either a real SHA or the honest `"unknown"` it had reported while
 * the variable was absent. The four call sites all used
 * `process.env.GIT_SHA ?? "unknown"`, and `??` guards only null/undefined,
 * so a set-but-empty variable sailed through and the deployment reported
 * an empty provenance string.
 *
 * Two things are fixed here:
 *
 * 1. An empty or whitespace-only value is treated as unset. Reporting
 *    `""` is worse than reporting `"unknown"` -- it looks like a value.
 * 2. `RAILWAY_GIT_COMMIT_SHA` is used as a fallback. Railway injects that
 *    into the running container automatically, so provenance no longer
 *    depends on the `GIT_SHA` build-arg plumbing resolving correctly
 *    through the Dockerfile's build stage -- which is exactly the link
 *    that appears to be failing.
 *
 * Takes its environment as a parameter (defaulting to `process.env`) so
 * the behaviour is directly testable without mutating global state.
 */
export function resolveGitSha(
  // Typed as an index signature rather than a two-key literal so
  // `process.env` (NodeJS.ProcessEnv) is directly assignable.
  env: Record<string, string | undefined> = process.env,
  // "dev" is the value all four pre-existing call sites already used for
  // "no SHA available", i.e. running locally. Kept as the default so this
  // change fixes the empty-string bug WITHOUT altering what a developer
  // sees locally.
  fallback: string = "dev",
): string {
  const explicit =
    env.GIT_SHA?.trim();

  if (explicit) {
    return explicit;
  }

  const railway =
    env.RAILWAY_GIT_COMMIT_SHA?.trim();

  if (railway) {
    return railway;
  }

  return fallback;
}
