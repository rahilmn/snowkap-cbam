/**
 * A small, pure, in-memory sliding-window rate limiter -- built for
 * docs/plans/MASTER_PLAN.md §28's "Rate limiting (P11) on auth,
 * mutation, import, and sharing endpoints" (see app/(auth)/actions.ts,
 * app/accept-invitation/actions.ts, and
 * app/api/evidence/upload/route.ts for the wired-in call sites).
 *
 * HONEST LIMITATION, stated plainly rather than overclaimed: this is a
 * single-process, in-memory counter. It does NOT survive a process
 * restart (every counter resets to zero on deploy/crash/scale event),
 * and it does NOT coordinate across multiple server instances (each
 * Railway/Node process enforces its own, independent limit -- N
 * instances behind a load balancer means the *effective* ceiling for
 * an attacker spread across them is N times the configured limit).
 * This is a deliberate, honest interim measure, not a production-final
 * solution: master plan §41 ("Open Decisions") lists a real,
 * shared rate-limit store (e.g. Redis) as a still-open owner decision
 * needed by P11. Replacing this module's internals with a shared-store
 * adapter later should not require call sites to change shape, since
 * they only depend on the RateLimiter interface below, not on
 * createInMemoryRateLimiter's implementation.
 *
 * Pure core, injected clock: `check` takes `nowMs` as a parameter
 * rather than calling Date.now() itself, so the sliding-window logic
 * is exercised deterministically in rate-limiter.test.ts without real
 * timers -- the same "pure function, caller supplies `now`" shape
 * src/domain/sharing/grant-lifecycle.ts's EXPIRE transition already
 * uses for the same reason. The one real Date.now() call per request
 * lives at each call site's own I/O boundary (the Server Action or
 * Route Handler), exactly where src/application already calls
 * `new Date().toISOString()` for its own persisted timestamps (e.g.
 * src/application/organizations/manage-membership.ts) -- this module
 * itself never touches the real clock.
 *
 * BOUNDED KEY COUNT (2026-08-29, P11 mandatory security review,
 * SHOULD-FIX finding #3/N1, independently confirmed live): `hitsByKey`
 * previously grew by one entry per distinct KEY forever, with no
 * eviction -- combined with get-client-ip.ts's own finding (#8/N1,
 * fixed alongside this one), every limiter in the app is reachable
 * unauthenticated (sign-in, sign-up), so an attacker rotating a
 * spoofed key on every request grew this map without bound: live-
 * reproduced at ~250 bytes retained per distinct spoofed key, no cap,
 * across five module-scope singleton limiters, a real unauthenticated
 * remote OOM path on a normal container. `maxKeys` (default
 * DEFAULT_MAX_KEYS below) bounds it with simple LRU eviction --
 * JS Map iteration order is insertion order, so re-inserting a key on
 * every check moves it to the "most recently used" end, and eviction
 * always removes from the "least recently used" front once the cap is
 * exceeded. This trades a small correctness cost (an evicted key's
 * window resets, same as if the process had just restarted) for a
 * hard memory ceiling -- no new dependency, per master plan §41's
 * "don't add a store speculatively" reasoning already applied
 * elsewhere in this codebase.
 */

export interface RateLimitConfig {
  // Maximum allowed hits for one key within one rolling window.
  readonly limit: number;

  readonly windowMs: number;

  // Upper bound on distinct keys this limiter retains at once, LRU-
  // evicted once exceeded. Defaults to DEFAULT_MAX_KEYS -- see this
  // file's header comment.
  readonly maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 50_000;

export interface RateLimitCheckResult {
  readonly allowed: boolean;

  // 0 when allowed. When rejected, how long (in ms) until the oldest
  // hit inside the current window ages out and a new one would be
  // allowed -- callers surface this as "try again in N seconds"
  // (Math.ceil(retryAfterMs / 1000)), never a bare "rejected".
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  /**
   * Records one attempt for `key` at `nowMs` and reports whether it's
   * within the configured limit. Check-and-record in one call
   * (there's no separate "peek without consuming") -- every call site
   * in this codebase wants exactly that: "was this attempt allowed,
   * and if so, count it," never a dry run.
   */
  check(
    key: string,
    nowMs: number,
  ): RateLimitCheckResult;
}

/**
 * Sliding-window LOG (not a fixed-bucket counter): each key stores the
 * exact timestamps of its recent hits, pruned to `windowMs` on every
 * check. Chosen over a fixed-window counter specifically to avoid the
 * fixed-window's well-known boundary-doubling flaw -- a fixed window
 * lets 2x the configured limit through across a single window
 * boundary (limit-many hits in the last instant of one window, then
 * limit-many more in the first instant of the next), which would
 * quietly double the real ceiling on exactly the auth/invitation
 * endpoints this module exists to bound. The tradeoff is the one
 * documented in this file's own header comment: unbounded per-key
 * memory growth over the life of a process (a key that is checked
 * once and never again keeps its (small) timestamp array forever,
 * since nothing here ever sees it "expire" without another check to
 * trigger the prune) -- acceptable for the bounded set of IPs a
 * single deploy actually sees before its next restart, not acceptable
 * as a permanent design; see this file's header comment.
 */
export function createInMemoryRateLimiter(
  config: RateLimitConfig,
): RateLimiter {
  const hitsByKey =
    new Map<string, number[]>();

  const maxKeys =
    config.maxKeys ?? DEFAULT_MAX_KEYS;

  // Records `hits` for `key`, marking it most-recently-used (deleting
  // then re-setting moves a Map entry to the end of its iteration
  // order), then evicts from the front (least-recently-used) until
  // back at or under maxKeys -- see this file's header comment.
  function touch(
    key: string,
    hits: number[],
  ): void {
    hitsByKey.delete(key);
    hitsByKey.set(key, hits);

    while (hitsByKey.size > maxKeys) {
      const oldestKey =
        hitsByKey.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      hitsByKey.delete(oldestKey);
    }
  }

  return {
    check(
      key: string,
      nowMs: number,
    ): RateLimitCheckResult {
      const windowStart =
        nowMs - config.windowMs;

      const previousHits =
        hitsByKey.get(key) ?? [];

      const hitsInWindow =
        previousHits.filter(
          (hitMs) => hitMs > windowStart,
        );

      if (hitsInWindow.length >= config.limit) {
        // hitsInWindow is never empty here (config.limit is always
        // >= 1 for every real config this codebase constructs), so
        // hitsInWindow[0] is always defined -- the non-null assertion
        // below is safe by construction, not a guess.
        const oldestHitMs =
          hitsInWindow[0] as number;

        touch(
          key,
          hitsInWindow,
        );

        return {
          allowed: false,
          retryAfterMs:
            Math.max(
              oldestHitMs + config.windowMs - nowMs,
              0,
            ),
        };
      }

      touch(
        key,
        [...hitsInWindow, nowMs],
      );

      return {
        allowed: true,
        retryAfterMs: 0,
      };
    },
  };
}
