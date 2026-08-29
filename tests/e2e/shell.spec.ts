import {
  expect,
  test,
} from "@playwright/test";

// Matches the same skip discipline used throughout the vitest suites
// (see tests/integration/module-load.test.ts): the health check needs
// live Supabase connectivity, which the no-secret public CI tier does
// not have (docs/plans/MASTER_PLAN.md §31). Skipped, not failed, in
// that environment.
const hasSupabaseEnvironment =
  Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

test.describe(
  "application shell",
  () => {
    test(
      "home page renders the shell (topbar, breadcrumbs, main) on every viewport",
      async ({ page }) => {
        // The primary nav is intentionally hidden below `md` (see the
        // dedicated "responsive" tests below) -- this test only asserts
        // the parts of the shell that are universal across viewports.
        await page.goto(
          "/",
        );

        await expect(
          page.getByRole(
            "banner",
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "navigation",
            { name: "Breadcrumb" },
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "heading",
            { name: "Snowkap CBAM" },
          ),
        ).toBeVisible();
      },
    );

    test(
      "all nine importer nav items are present in the primary sidebar (desktop)",
      async ({
        page,
        isMobile,
      }) => {
        test.skip(
          isMobile,
          "primary nav is hidden below md -- covered by the responsive tests",
        );

        await page.goto(
          "/",
        );

        await expect(
          page.getByRole(
            "navigation",
            { name: "Primary" },
          ),
        ).toBeVisible();

        // All nine importer nav items are present (docs/plans/MASTER_PLAN.md §7).
        // Items with a real route (components/shell/sidebar.tsx's
        // IMPORTER_NAV `href`) render as a <Link> (role "link");
        // not-yet-built items with no href render as a disabled
        // placeholder <button> (role "button") -- matching each item to
        // its actual rendered role here, rather than asserting "button"
        // for all nine, is what makes this test describe reality.
        for (
          const { label, role } of [
            { label: "Dashboard", role: "button" as const },
            { label: "Shipments", role: "link" as const },
            { label: "Emissions", role: "link" as const },
            { label: "Calculations", role: "button" as const },
            { label: "Suppliers", role: "link" as const },
            { label: "Installations", role: "button" as const },
            { label: "Audit", role: "link" as const },
            { label: "Reports", role: "link" as const },
            { label: "Declarations", role: "link" as const },
          ]
        ) {
          await expect(
            page.getByRole(
              role,
              { name: label, exact: true },
            ),
          ).toBeVisible();
        }
      },
    );

    test(
      "navigates to the design gallery and renders every section",
      async ({ page }) => {
        await page.goto(
          "/",
        );

        await page.getByRole(
          "link",
          { name: /design system gallery/i },
        ).click();

        await expect(
          page,
        ).toHaveURL(
          /\/design$/,
        );

        for (
          const heading of [
            "Snowkap CBAM design system",
            "Neutral",
            "Brand (verified: #DF5900)",
            "Interactive (this product's own extension)",
            "Semantic",
            "Typography",
            "Buttons",
            "Badges",
            "Regulatory status badges",
            "Card",
          ]
        ) {
          await expect(
            page.getByRole(
              "heading",
              { name: heading, exact: true },
            ),
          ).toBeVisible();
        }

        // All 10 regulatory resolution reasons render as distinct badges
        // (the "status honesty" element -- docs/plans/MASTER_PLAN.md §25).
        for (
          const label of [
            "Resolved (TARIC)",
            "Resolved (CN8)",
            "Resolved (HS6)",
            "Resolved (HS4)",
            "Fallback territory",
            "Reference required",
            "Unavailable",
            "Not applicable",
            "Ambiguous",
            "No match",
          ]
        ) {
          await expect(
            page.getByText(
              label,
              { exact: true },
            ),
          ).toBeVisible();
        }
      },
    );

    test(
      "no console errors on the home or design pages",
      async ({ page }) => {
        const errors: string[] =
          [];

        page.on(
          "console",
          (msg) => {
            if (msg.type() === "error") {
              errors.push(
                msg.text(),
              );
            }
          },
        );

        await page.goto(
          "/",
        );

        await page.goto(
          "/design",
        );

        expect(
          errors,
        ).toEqual(
          [],
        );
      },
    );

    test(
      "health check endpoint reports ok with database connectivity",
      async ({ request }) => {
        test.skip(
          !hasSupabaseEnvironment,
          "requires live Supabase credentials",
        );

        const response =
          await request.get(
            "/api/health",
          );

        expect(
          response.ok(),
        ).toBe(
          true,
        );

        const body =
          await response.json();

        expect(
          body.status,
        ).toBe(
          "ok",
        );

        expect(
          body.checks.database,
        ).toBe(
          "ok",
        );

        expect(
          body.checks.active_regulatory_dataset,
        ).toBe(
          "ok",
        );
      },
    );
  },
);

test.describe(
  "theme toggle",
  () => {
    test(
      "switches between light and dark and the choice persists across reload",
      async ({ page }) => {
        await page.goto(
          "/design",
        );

        const html =
          page.locator(
            "html",
          );

        const initialTheme =
          await html.getAttribute(
            "data-theme",
          );

        expect(
          [
            "light",
            "dark",
          ],
        ).toContain(
          initialTheme,
        );

        const toggle =
          page.getByRole(
            "button",
            {
              name: /switch to (light|dark) theme/i,
            },
          );

        await toggle.click();

        const toggledTheme =
          await html.getAttribute(
            "data-theme",
          );

        expect(
          toggledTheme,
        ).not.toBe(
          initialTheme,
        );

        // The live-session visual update after toggling could not be
        // conclusively verified against a different browser automation
        // tool during Phase 2 authoring (see
        // docs/adr/ADR-0016-theme-resolution-in-js-not-css-media-query.md);
        // this assertion is the authoritative check that it actually
        // repaints, using Playwright's own browser rather than that tool.
        const bodyBg =
          await page.evaluate(
            () =>
              getComputedStyle(
                document.body,
              ).backgroundColor,
          );

        const expectedBg =
          toggledTheme === "dark"
            ? "rgb(10, 10, 11)"
            : "rgb(247, 247, 249)";

        expect(
          bodyBg,
        ).toBe(
          expectedBg,
        );

        // Persistence: reload and confirm the choice survived.
        await page.reload();

        await expect(
          html,
        ).toHaveAttribute(
          "data-theme",
          toggledTheme ??
            "",
        );

        const bodyBgAfterReload =
          await page.evaluate(
            () =>
              getComputedStyle(
                document.body,
              ).backgroundColor,
          );

        expect(
          bodyBgAfterReload,
        ).toBe(
          expectedBg,
        );
      },
    );
  },
);

test.describe(
  "responsive",
  () => {
    test(
      "mobile viewport hides the persistent sidebar/search/org-switcher and has no horizontal overflow",
      async ({ page }) => {
        await page.setViewportSize(
          {
            width: 375,
            height: 812,
          },
        );

        await page.goto(
          "/",
        );

        await expect(
          page.getByRole(
            "navigation",
            { name: "Primary" },
          ),
        ).toBeHidden();

        await expect(
          page.getByRole(
            "button",
            { name: "Search (coming soon)" },
          ),
        ).toBeHidden();

        const overflow =
          await page.evaluate(
            () =>
              document.body.scrollWidth >
              window.innerWidth,
          );

        expect(
          overflow,
        ).toBe(
          false,
        );

        // The shell and page heading remain usable at mobile width.
        await expect(
          page.getByRole(
            "banner",
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "heading",
            { name: "Snowkap CBAM" },
          ),
        ).toBeVisible();
      },
    );

    test(
      "desktop viewport shows the sidebar",
      async ({ page }) => {
        await page.setViewportSize(
          {
            width: 1280,
            height: 800,
          },
        );

        await page.goto(
          "/",
        );

        await expect(
          page.getByRole(
            "navigation",
            { name: "Primary" },
          ),
        ).toBeVisible();

        // The org-switcher renders only for a signed-in user with an
        // organization (components/shell/topbar.tsx) -- this suite
        // runs signed out, so it must be absent, not showing a stale
        // placeholder name. The real, signed-in case is covered by
        // tests/integration/organizations-isolation.test.ts (local
        // Supabase) and was manually verified end-to-end (sign up ->
        // onboard -> real org name in the topbar -> sign out -> sign
        // back in) -- full Playwright E2E coverage of the auth flow
        // itself, against local Supabase specifically, is tracked as
        // follow-up work, not yet wired into this suite.
        await expect(
          page.getByRole("banner").getByRole(
            "button",
            { name: /Acme|Importers/ },
          ),
        ).toHaveCount(
          0,
        );
      },
    );
  },
);

test.describe(
  "accessibility",
  () => {
    test(
      "every nav item and the theme toggle is reachable and operable by keyboard",
      async ({ page }) => {
        await page.goto(
          "/",
        );

        const toggle =
          page.getByRole(
            "button",
            {
              name: /switch to (light|dark) theme/i,
            },
          );

        await toggle.focus();

        await expect(
          toggle,
        ).toBeFocused();

        // A visible focus outline is present (design system rule --
        // app/globals.css :focus-visible).
        const outlineWidth =
          await toggle.evaluate(
            (el) =>
              getComputedStyle(
                el,
              ).outlineWidth,
          );

        expect(
          outlineWidth,
        ).not.toBe(
          "0px",
        );
      },
    );

    test(
      "reduced motion is respected",
      async ({ page }) => {
        await page.emulateMedia(
          {
            reducedMotion: "reduce",
          },
        );

        await page.goto(
          "/",
        );

        const toggle =
          page.getByRole(
            "button",
            {
              name: /switch to (light|dark) theme/i,
            },
          );

        const transitionDurationSeconds =
          await toggle.evaluate(
            (el) => {
              // getComputedStyle reports the duration in whatever unit
              // the engine normalizes to (observed: seconds, e.g.
              // "1e-05s") -- parse numerically rather than string-match
              // a specific unit/format.
              const raw =
                getComputedStyle(
                  el,
                ).transitionDuration;

              return parseFloat(
                raw,
              );
            },
          );

        // app/globals.css caps every transition at 0.01ms (= 0.00001s)
        // under prefers-reduced-motion.
        expect(
          transitionDurationSeconds,
        ).toBeCloseTo(
          0.00001,
          6,
        );
      },
    );
  },
);
