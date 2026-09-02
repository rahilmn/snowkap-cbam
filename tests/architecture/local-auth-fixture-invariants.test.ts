import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

/**
 * 2026-09-03 (Phase 2 review, WP-A precondition).
 *
 * The auth email templates build every link from `{{ .SiteURL }}`, which
 * GoTrue resolves from `supabase/config.toml`'s `site_url`. Playwright
 * drives the app at `playwright.config.ts`'s `baseURL`. Those two are
 * written independently, in different files, in different syntaxes --
 * and if their PORTS ever diverge, every emailed link the E2E suite
 * follows points at a dead port. The failure would surface as a generic
 * navigation timeout deep inside an invitation journey, not as a
 * configuration error.
 *
 * The hosts deliberately differ (127.0.0.1 vs localhost -- see
 * tests/support/mailpit.ts's rebaseOrigin, which exists because the two
 * are separate cookie jars). Only the port is an invariant.
 */
describe(
  "local auth fixture invariants",
  () => {
    it(
      "keeps supabase config.toml's site_url port in lockstep with playwright's baseURL port",
      () => {
        const config =
          readFileSync(
            "supabase/config.toml",
            "utf-8",
          );

        const playwright =
          readFileSync(
            "playwright.config.ts",
            "utf-8",
          );

        const siteUrl =
          /^site_url\s*=\s*"([^"]+)"/m.exec(
            config,
          );

        const baseUrl =
          /baseURL:\s*"([^"]+)"/.exec(
            playwright,
          );

        expect(siteUrl).not.toBeNull();
        expect(baseUrl).not.toBeNull();

        expect(
          new URL(siteUrl![1]).port,
        ).toBe(
          new URL(baseUrl![1]).port,
        );
      },
    );

    it(
      "keeps the local email_sent rate limit high enough for the WP-A suites to run deterministically",
      () => {
        // At the CLI default of 2/hour the invitation + recovery +
        // magic-link specs trip over_email_send_rate_limit mid-run.
        // This is a LOCAL fixture only; it has no hosted counterpart.
        const config =
          readFileSync(
            "supabase/config.toml",
            "utf-8",
          );

        const emailSent =
          /^email_sent\s*=\s*(\d+)/m.exec(
            config,
          );

        expect(emailSent).not.toBeNull();
        expect(
          Number(emailSent![1]),
        ).toBeGreaterThanOrEqual(
          50,
        );
      },
    );
  },
);
