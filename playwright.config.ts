import {
  existsSync,
  readFileSync,
} from "node:fs";

import {
  defineConfig,
  devices,
} from "@playwright/test";

import {
  E2E_DIST_DIR,
} from "./scripts/build/dist-dir.mjs";

/**
 * Minimal, dependency-free ".env"-shape parser: KEY=VALUE per line,
 * '#'-prefixed and blank lines skipped, no interpolation/multiline
 * support -- this codebase's own .env/.env.local files never use
 * either. Existing keys in `into` are never overwritten (first file
 * parsed wins), mirroring dotenv's own "don't override an already-set
 * key" convention -- which is exactly the semantic this function
 * exists to guarantee explicitly, see the call site below for why.
 */
function parseEnvFileInto(
  path: string,
  into: Record<string, string>,
): void {
  if (!existsSync(path)) {
    return;
  }

  for (
    const line of readFileSync(path, "utf8").split("\n")
  ) {
    const trimmed =
      line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq =
      trimmed.indexOf("=");

    if (eq === -1) {
      continue;
    }

    const key =
      trimmed.slice(0, eq).trim();

    if (key in into) {
      continue;
    }

    into[key] =
      trimmed.slice(eq + 1).trim();
  }
}

/**
 * 2026-08-30 (P13 §16.8/§26, determinism fix, part 4 -- the deepest
 * and most consequential of the four): live-reproduced, via direct
 * Postgres instrumentation, that the regulatory adapter's
 * `getSupabaseClient()` (src/infrastructure/supabase/client.ts) was
 * resolving `SUPABASE_URL` to THIS MACHINE'S `.env` (the remote
 * hosted project `.env.example`/regulatory-pipeline credentials
 * document) instead of `.env.local` (the correct override to the
 * local Supabase instance) when the app runs as Next.js 16's
 * standalone production server (`node .next/standalone/server.js` --
 * exactly what `webServer.command` below runs), even though
 * `NEXT_PUBLIC_SUPABASE_URL` (inlined at build time by `next build`,
 * which loads env files correctly) resolved to local as expected the
 * whole time. Confirmed byte-for-byte: the rejected determination's
 * claimed regulatory dataset_id matched the REMOTE project's own
 * ACTIVE `regulatory_datasets` row exactly, not any row in local
 * Postgres. client.ts's own memoized-client caching was hardened
 * separately (its own doc comment) but did not fix this on its own --
 * the wrong value was resolved consistently, every call, not merely
 * on a first call later corrected. Root cause is Next's own standalone
 * server env-file loading, outside this repo's control and not
 * necessarily stable across Next versions -- so rather than depend on
 * it, this explicitly resolves `.env.local` (falling back to `.env`
 * for anything `.env.local` doesn't set, matching Next's own
 * documented precedence) and passes the result directly into
 * `webServer.env`, which Node guarantees becomes the spawned
 * process's actual `process.env` regardless of whatever the
 * standalone server's own file-loading does or doesn't do correctly.
 */
const resolvedEnv: Record<string, string> =
  {};

parseEnvFileInto(".env.local", resolvedEnv);
parseEnvFileInto(".env", resolvedEnv);

/**
 * Phase 2 smoke suite (docs/plans/MASTER_PLAN.md P2 scope: "Playwright
 * smoke (shell renders, nav works, both themes, mobile viewport)").
 * Runs against a locally-built/started app -- webServer below handles
 * both `pnpm test:e2e` (CI, against a production build) and manual
 * local runs.
 */
export default defineConfig(
  {
    testDir: "./tests/e2e",

    fullyParallel: true,
    forbidOnly: !!process.env.CI,

    // 2026-08-30: previously CI-only (0 locally) -- now unconditional.
    // See `workers`'s own comment below for the full determinism
    // narrative; a residual single-spec flake under real concurrent
    // load survived even at workers=3, cleared on retry every time it
    // was observed. Two retries (matching what CI already had) absorbs
    // a genuine transient concurrency blip without masking a test that
    // is actually, persistently broken -- that would still fail all
    // three attempts.
    retries: 2,

    // 2026-08-30 (P13 §16.8/§26, determinism fix, part 2 of 3 -- part
    // 1 is the rate-limit bypass in webServer.env below, part 3 is
    // `retries` above): capped rather than left to default to every
    // available CPU core. Empirically confirmed this session -- the
    // unlimited default (6 workers x 2 browser projects against ONE
    // local Supabase instance and ONE Node server process) produced
    // 5-7 failing specs per run, every one a real backend operation
    // (sign-up, shipment creation, a CBAM-goods search, regulatory
    // resolution) either timing out or throwing a raw `fetch failed`
    // under that much concurrent connection pressure -- NOT a
    // rate-limit collision (already ruled out: the same failures
    // persisted with DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS
    // active) and NOT a code regression (every spec passes cleanly run
    // individually, and via `retries` above when run concurrently).
    // 3 was the most consistent value found in this session's own
    // repeated trials (workers=6 -> 5-7 failures; workers=4 -> 1
    // failure plus a raw fetch error; workers=3/2 -> 1 failure, same
    // single heavier spec, cleared by a retry). A local Supabase
    // instance + one Node server process is a fixed-capacity backend
    // this suite cannot outrun by adding more Playwright workers --
    // this is that ceiling made explicit rather than rediscovered by
    // flaky-test whack-a-mole later.
    workers: 3,

    // Default is 5000ms -- too tight for a full-journey spec's real
    // Supabase-backed operations (regulatory resolution against the
    // 12,540-row default_emission_values table, in particular) under
    // any concurrent load at all: the same "EXACT CN8 MATCH" assertion
    // still occasionally missed a plain 5s window even at workers=2,
    // despite the underlying resolve completing correctly every time
    // in a fully isolated single-spec run. This does not relax what's
    // being asserted, only how long a real backend round trip is given
    // to complete before the assertion is treated as failed.
    expect: {
      timeout: 10_000,
    },

    reporter: "list",

    use: {
      baseURL: "http://localhost:3000",
      trace: "retain-on-failure",
    },

    projects: [
      {
        name: "chromium",
        use: {
          ...devices["Desktop Chrome"],
        },
      },

      {
        name: "mobile-chromium",
        use: {
          ...devices["Pixel 7"],
        },
      },
    ],

    webServer: {
      // 2026-09-03 (P14). Starts the artifact the build on the left of
      // the && just produced. next.config.ts redirects a bypass build
      // to .next-e2e, so `pnpm start` -- which stays permanently pinned
      // to the deployable .next -- would start the wrong tree, or a
      // stale one, or nothing at all.
      //
      // Deliberately NOT solved by making `pnpm start` resolve the
      // directory from the environment: that would hand a developer who
      // happens to have the bypass variable exported a rate-limit-free
      // server from a plain `pnpm start`, which is the exact inversion
      // of the invariant this change exists to create.
      command: `pnpm build && node ${E2E_DIST_DIR}/standalone/server.js`,
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,

      // 2026-08-30 (P13 §16.8/§26): the suite's own natural sign-up/
      // mutation volume self-trips the app's real rate limiters within
      // one run -- see src/infrastructure/rate-limit/rate-limiter.ts's
      // "E2E-HARNESS ESCAPE HATCH" header comment for the full
      // reasoning and why this is safe. Only reaches the server
      // process Playwright itself starts here; reusing an already-
      // running `pnpm dev` locally does NOT get this env var unless a
      // developer exports it themselves before starting that server.
      //
      // `...resolvedEnv` (see its own definition above): explicitly
      // resolved SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/etc., correct
      // `.env.local`-over-`.env` precedence guaranteed by this file's
      // own parser rather than left to the standalone server's -- see
      // that comment for the full, live-reproduced account of why.
      env: {
        ...resolvedEnv,
        // Two keys as of 2026-08-31, see rate-limiter.ts. This one is
        // read at BUILD time (Next inlines NEXT_PUBLIC_* as literals),
        // and `command` above runs `pnpm build` before booting the
        // server, so this env block covers the build too -- which is the
        // point. Since 2026-09-03 that build lands in `.next-e2e`
        // rather than `.next`, so a bypassing artifact can no longer be
        // left where the Dockerfile would copy it. A production
        // image built without it has the bypass compiled out entirely,
        // so the runtime key below cannot re-enable it there no matter
        // who sets it.
        NEXT_PUBLIC_E2E_RATE_LIMIT_BYPASS_BUILD: "true",
        DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS: "true",
      },
    },
  },
);
