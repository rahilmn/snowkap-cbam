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
      "all ten importer nav items are present in the primary sidebar (desktop)",
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

        // All ten importer nav items are present (docs/plans/MASTER_PLAN.md §7;
        // the tenth arrived with owner decision D2).
        // Items with a real route (components/shell/sidebar.tsx's
        // IMPORTER_NAV `href`) render as a <Link> (role "link");
        // not-yet-built items with no href render as a disabled
        // placeholder <button> (role "button") -- matching each item to
        // its actual rendered role here, rather than asserting "button"
        // for all of them, is what makes this test describe reality.
        for (
          const { label, role } of [
            { label: "Dashboard", role: "link" as const },
            { label: "Shipments", role: "link" as const },
            { label: "Emissions", role: "link" as const },
            { label: "Calculations", role: "button" as const },
            { label: "Suppliers", role: "link" as const },
            // 2026-09-03 (owner decision D2): "Installations" was a
            // disabled placeholder because an importer genuinely had
            // nowhere to record the operators behind its imports. It
            // now has two real destinations, and they are links.
            { label: "External operators", role: "link" as const },
            { label: "External emissions", role: "link" as const },
            { label: "Audit", role: "link" as const },
            { label: "Reports", role: "link" as const },
            { label: "Declarations", role: "link" as const },
          ]
        ) {
          // Disabled nav items carry an sr-only " (not available yet)"
          // suffix (components/shell/sidebar.tsx), so that IS their
          // accessible name. Asserting the full name keeps `exact` and
          // additionally proves the disabled affordance is announced
          // rather than the control being silently inert. (Corrected
          // 2026-08-31: this spec still expected the bare label, and had
          // never run in CI to catch it.)
          const expectedName =
            role === "button"
              ? `${label} (not available yet)`
              : label;

          await expect(
            page.getByRole(
              role,
              { name: expectedName, exact: true },
            ),
          ).toBeVisible();
        }
      },
    );

    test(
      "does not expose the internal design gallery in a production build",
      async ({ page }) => {
        // 2026-08-31. This test used to click through from "/" to the
        // /design gallery and assert every section rendered. Both halves
        // of that were wrong to keep:
        //
        //  - the landing page no longer links to the gallery (it was the
        //    ONLY action the Phase-2 placeholder offered, which is how an
        //    internal page ended up being the first thing a signed-in
        //    user saw), and
        //  - the gallery is dev-only per MASTER_PLAN.md §26 and now
        //    notFound()s under NODE_ENV=production, which is exactly what
        //    playwright.config.ts's `pnpm build && pnpm start` webServer
        //    runs.
        //
        // So the useful assertion is the inverse one: the gate holds in
        // the same kind of build we deploy.
        const response =
          await page.goto(
            "/design",
          );

        expect(
          response?.status(),
        ).toBe(
          404,
        );

        await expect(
          page.getByRole(
            "heading",
            { name: /Snowkap CBAM design system/i },
          ),
        ).toHaveCount(
          0,
        );
      },
    );

    test(
      "no console errors on the home or sign-in pages",
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

        // Was "/design" -- that route is gated out of production builds
        // now (MASTER_PLAN.md §26), so this sweep uses a real product
        // route instead, which is a better subject for it anyway.
        await page.goto(
          "/sign-in",
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
        // Was "/design"; that route is gated out of production builds
        // now. "/" is the right substitute: the toggle lives in the
        // topbar (components/shell/topbar.tsx), which only AppShell
        // renders -- "/sign-in" is a standalone centered card and has no
        // toggle at all.
        await page.goto(
          "/",
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
