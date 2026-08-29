import {
  defineConfig,
  devices,
} from "@playwright/test";

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
    retries: process.env.CI ? 2 : 0,

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
      command: "pnpm build && pnpm start",
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
      env: {
        DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS: "true",
      },
    },
  },
);
