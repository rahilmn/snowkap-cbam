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
  },
  resolve: {
    alias: {
      // See tests/stubs/server-only.ts for why this alias exists.
      "server-only": `${dirname}tests/stubs/server-only.ts`,
    },
  },
});
