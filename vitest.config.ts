import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    // tests/e2e/** belongs to Playwright (see playwright.config.ts), not
    // vitest -- without this exclusion vitest's default *.spec.ts glob
    // picks up shell.spec.ts and fails calling test.describe() outside
    // Playwright's own runner.
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
    ],

    // 2026-08-31. Vitest runs test FILES in parallel by default. Nine
    // files under tests/integration/** all create organizations,
    // memberships and audit events against ONE shared local Postgres,
    // and two of them exercise the last-active-OWNER trigger
    // (20260829570000), which takes `FOR UPDATE` row locks across every
    // other active OWNER row.
    //
    // That combination produced a real, observed intermittent failure:
    // "OWNER can change another member's role and remove them..." and
    // the membership CAS-guard case both failed once in a full run, then
    // passed 18/18 in isolation and across four consecutive full runs.
    // A gate that fails once every few runs is worse than a slow one --
    // it teaches you to re-run instead of to read.
    //
    // `fileParallelism: false` serialises FILE execution (tests within a
    // file were already sequential). The unit suites are pure and fast,
    // so the cost is wall-clock only, and determinism on a gate that
    // decides releases is worth more than the seconds.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // See tests/stubs/server-only.ts for why this alias exists.
      "server-only": `${dirname}tests/stubs/server-only.ts`,
    },
  },
});
