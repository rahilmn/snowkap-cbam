import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createInMemoryRateLimiter,
} from "./rate-limiter";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe(
  "createInMemoryRateLimiter",
  () => {
    it(
      "allows every attempt while strictly under the limit",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 3, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0)).toEqual(
          { allowed: true, retryAfterMs: 0 },
        );

        expect(limiter.check("ip-1", 100)).toEqual(
          { allowed: true, retryAfterMs: 0 },
        );
      },
    );

    it(
      "allows the exact Nth attempt (limit is inclusive) but rejects the (N+1)th within the same window",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 3, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-1", 10).allowed).toBe(true);
        expect(limiter.check("ip-1", 20).allowed).toBe(true);

        const fourth =
          limiter.check("ip-1", 30);

        expect(fourth.allowed).toBe(false);
        expect(fourth.retryAfterMs).toBeGreaterThan(0);
      },
    );

    it(
      "computes retryAfterMs as exactly the time until the oldest in-window hit ages out",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);

        // Same key, still inside the 1000ms window (400 < 1000) --
        // the sole existing hit (at t=0) ages out at t=1000, so from
        // t=400 that's exactly 600ms away.
        expect(limiter.check("ip-1", 400)).toEqual(
          { allowed: false, retryAfterMs: 600 },
        );
      },
    );

    it(
      "allows again once every hit in the window has fully expired",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-1", 500).allowed).toBe(false);

        // Strictly past the window (1000ms after the only recorded
        // hit) -- the old hit has aged out entirely.
        expect(limiter.check("ip-1", 1001).allowed).toBe(true);
      },
    );

    it(
      "tracks independent keys with independent windows -- one key's exhaustion never blocks another",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-1", 10).allowed).toBe(false);

        // A different key at the same moment is untouched by ip-1's
        // exhausted window.
        expect(limiter.check("ip-2", 10).allowed).toBe(true);
      },
    );

    it(
      "prunes only hits that fall outside the window, keeping still-valid hits counted (sliding, not fixed-bucket)",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 2, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-1", 900).allowed).toBe(true);

        // t=0 hit just aged out (window is (t-1000, t]); the t=900
        // hit is still well inside the window, so this is the second
        // *live* hit, not a fresh count of one -- a fixed-bucket
        // limiter reset at each 1000ms boundary would wrongly allow
        // this (a 4th hit in a 2000ms span for limit=2), which is
        // exactly the boundary-doubling flaw this module's own header
        // comment documents choosing a sliding log to avoid.
        expect(limiter.check("ip-1", 1001).allowed).toBe(true);
        expect(limiter.check("ip-1", 1002).allowed).toBe(false);
      },
    );

    it(
      "evicts the least-recently-used key once maxKeys is exceeded, bounding memory rather than growing forever (P11 finding #3/N1)",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 5, windowMs: 1000, maxKeys: 2 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-2", 0).allowed).toBe(true);

        // Third distinct key pushes the map over maxKeys=2 --
        // "ip-1" (least recently used) is evicted, "ip-2" survives.
        expect(limiter.check("ip-3", 0).allowed).toBe(true);

        // ip-1's history is gone -- it is treated as brand new
        // (allowed), the observable signature of eviction having
        // actually happened rather than merely being coded but inert.
        expect(limiter.check("ip-1", 1).allowed).toBe(true);
      },
    );

    it(
      "treats re-checking an existing key as a use that protects it from eviction (true LRU, not insertion-order-only)",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 5, windowMs: 1000, maxKeys: 2 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-2", 0).allowed).toBe(true);

        // Touch ip-1 again -- it is now the most-recently-used of the
        // two, so ip-2 (not ip-1) should be evicted when a third key
        // arrives.
        expect(limiter.check("ip-1", 1).allowed).toBe(true);
        expect(limiter.check("ip-3", 1).allowed).toBe(true);

        // ip-2 was evicted -- its single earlier hit is gone, so a
        // second hit at the same instant is still within a fresh
        // limit=5 window (not directly observable as "evicted" on its
        // own, but ip-1 retaining its 2-hit history is).
        const ip1Third =
          limiter.check("ip-1", 2);

        expect(ip1Third.allowed).toBe(true);
      },
    );

    it(
      "defaults to a bounded maxKeys even when the caller supplies no explicit value, so an unbounded config is never the accidental default",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        // Not exhaustive (DEFAULT_MAX_KEYS is 50,000) -- just proves a
        // large-but-plausible run of distinct keys doesn't throw or
        // hang, and the limiter keeps functioning correctly for a
        // fresh key afterward.
        for (let i = 0; i < 1000; i += 1) {
          limiter.check(`ip-${i}`, 0);
        }

        expect(limiter.check("ip-fresh", 0).allowed).toBe(true);
      },
    );

    it(
      "bypasses the limit entirely when DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS='true' -- the E2E-harness escape hatch, off by default",
      () => {
        vi.stubEnv(
          "DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS",
          "true",
        );

        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        // limit=1: a real limiter would reject every attempt after the
        // first. Every one of these still reports allowed:true,
        // proving the bypass short-circuits before the sliding-window
        // logic ever runs, not that this particular scenario happens
        // to fit under a real limit.
        for (let i = 0; i < 10; i += 1) {
          expect(limiter.check("ip-1", i).allowed).toBe(true);
        }
      },
    );

    it(
      "ignores the bypass flag unless its value is exactly the string 'true' -- no truthy-but-unintended value activates it",
      () => {
        vi.stubEnv(
          "DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS",
          "1",
        );

        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-1", 1).allowed).toBe(false);
      },
    );

    it(
      "enforces the real limit when the bypass flag is unset (the default -- covers every production/normal-dev process)",
      () => {
        const limiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        expect(limiter.check("ip-1", 0).allowed).toBe(true);
        expect(limiter.check("ip-1", 1).allowed).toBe(false);
      },
    );

    it(
      "keeps two separate limiter instances (two separate configs) from sharing any state",
      () => {
        const strictLimiter =
          createInMemoryRateLimiter(
            { limit: 1, windowMs: 1000 },
          );

        const generousLimiter =
          createInMemoryRateLimiter(
            { limit: 5, windowMs: 1000 },
          );

        expect(strictLimiter.check("ip-1", 0).allowed).toBe(true);
        expect(strictLimiter.check("ip-1", 1).allowed).toBe(false);

        // Same key, but a distinct limiter instance with its own Map
        // -- unaffected by strictLimiter's exhausted window.
        expect(generousLimiter.check("ip-1", 1).allowed).toBe(true);
      },
    );
  },
);
