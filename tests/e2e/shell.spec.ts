import {
  test as base,
  expect,
} from "@playwright/test";

import {
  randomUUID,
} from "node:crypto";

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

/**
 * 2026-09-05 (SME plan v2.1.1, S1). This whole file used to assert
 * signed-OUT shell content at "/" -- which stopped existing once
 * app/page.tsx started redirecting a genuinely signed-out visitor to
 * /sign-in (closing the gap that redirect itself exists to close).
 * Every test below is re-based onto a real, authenticated importer
 * session instead of being deleted or left permanently fixme'd.
 *
 * One real sign-up -> onboarding flow (the same genuine UI interaction
 * tests/e2e/fixtures/authenticated-importer.ts already does for the
 * journey specs) runs ONCE PER WORKER via the `sharedImporterAuth`
 * fixture below, not once per test -- this file only needs one
 * authenticated importer org to exist, shared across every test that
 * asserts shell chrome, not a fresh one per assertion. The resulting
 * storage state is written to a per-worker file and wired back in as
 * this file's own `storageState`, so every test's `page` fixture is
 * already signed in by the time the test body runs.
 */
interface SharedImporterAuth {
  storageStatePath: string;
  organizationName: string;
}

const test =
  base.extend<
    {},
    { sharedImporterAuth: SharedImporterAuth }
  >(
    {
      sharedImporterAuth: [
        async (
          { browser },
          use,
          workerInfo,
        ) => {
          // browser.newContext() does NOT inherit playwright.config.ts's
          // use.baseURL the way the built-in `context`/`page` fixtures
          // do -- a context built directly from `browser` needs it
          // passed explicitly, or a relative page.goto("/sign-up")
          // below fails with "Cannot navigate to invalid URL" (found by
          // actually running this suite, not assumed).
          const context =
            await browser.newContext(
              {
                baseURL: workerInfo.project.use.baseURL,
              },
            );

          const page =
            await context.newPage();

          const runId =
            randomUUID().slice(
              0,
              8,
            );

          const email =
            `e2e-shell-${runId}@example.com`;

          const password =
            "Password123!";

          const organizationName =
            `E2E Shell Org ${runId}`;

          // --- Sign up (app/(auth)/sign-up/sign-up-form.tsx) ---

          await page.goto(
            "/sign-up",
          );

          await page.getByLabel(
            "Email",
            { exact: true },
          ).fill(
            email,
          );

          await page.getByLabel(
            "Password",
            { exact: true },
          ).fill(
            password,
          );

          await page.getByRole(
            "button",
            { name: "Create account" },
          ).click();

          // Local Supabase has enable_confirmations = false, so
          // signUpAction gets a session immediately and redirects
          // straight to /onboarding (no email click-through).
          await expect(
            page,
          ).toHaveURL(
            /\/onboarding$/,
          );

          // --- Onboarding (app/onboarding/onboarding-form.tsx) ---

          await page.getByLabel(
            "Organization name",
          ).fill(
            organizationName,
          );

          await page.getByRole(
            "checkbox",
            { name: /Importer \/ Declarant/ },
          ).check();

          await page.getByRole(
            "button",
            { name: "Create organization" },
          ).click();

          // createOrganizationAction redirects to "/" on success.
          await expect(
            page,
          ).toHaveURL(
            "/",
          );

          const storageStatePath =
            `test-results/.auth/shell-importer-${workerInfo.workerIndex}.json`;

          await context.storageState(
            {
              path: storageStatePath,
            },
          );

          await context.close();

          await use(
            {
              storageStatePath,
              organizationName,
            },
          );
        },
        { scope: "worker" },
      ],

      storageState: async (
        { sharedImporterAuth },
        use,
      ) => {
        await use(
          sharedImporterAuth.storageStatePath,
        );
      },
    },
  );

test.describe(
  "application shell",
  () => {
    test(
      "home page renders the shell (topbar, breadcrumbs, main) on every viewport",
      async (
        { page, sharedImporterAuth },
      ) => {
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

        // A signed-in user with an org sees their own organization's
        // name as the page heading (app/page.tsx), not the generic
        // "Snowkap CBAM" wordmark -- that literal only ever renders for
        // a signed-in user with NO org yet, which this session is not.
        await expect(
          page.getByRole(
            "heading",
            { name: sharedImporterAuth.organizationName },
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

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        await expect(
          primaryNav,
        ).toBeVisible();

        // All nine importer nav items are present (docs/plans/MASTER_PLAN.md §7;
        // the ninth arrived with owner decision D2; Calculations was
        // removed as a genuinely nonexistent placeholder -- SME plan
        // v2.1.1, S1).
        // Items with a real route (components/shell/sidebar.tsx's
        // IMPORTER_NAV `href`) render as a <Link> (role "link");
        // not-yet-built items with no href render as a disabled
        // placeholder <button> (role "button") -- matching each item to
        // its actual rendered role here, rather than asserting "button"
        // for all of them, is what makes this test describe reality.
        const importerNavItems: {
          label: string;
          role: "link" | "button";
        }[] =
          [
            { label: "Dashboard", role: "link" },
            { label: "Shipments", role: "link" },
            { label: "Emissions", role: "link" },
            { label: "Suppliers", role: "link" },
            // 2026-09-03 (owner decision D2): "Installations" was a
            // disabled placeholder because an importer genuinely had
            // nowhere to record the operators behind its imports. It
            // now has two real destinations, and they are links.
            { label: "External operators", role: "link" },
            { label: "External emissions", role: "link" },
            { label: "Audit", role: "link" },
            { label: "Reports", role: "link" },
            { label: "Declarations", role: "link" },
          ];

        for (
          const { label, role } of importerNavItems
        ) {
          // Disabled nav items carry an sr-only " (not available yet)"
          // suffix (components/shell/sidebar.tsx), so that IS their
          // accessible name. Asserting the full name keeps `exact` and
          // additionally proves the disabled affordance is announced
          // rather than the control being silently inert. (Corrected
          // 2026-08-31: this spec still expected the bare label, and had
          // never run in CI to catch it.)
          // 2026-09-03 (P14, WP-E). The sr-only suffix now carries the
          // ACTUAL reason rather than the blanket "not available yet",
          // which for Evidence and Verification was simply false --
          // both are fully built and live inline on each dataset. So a
          // disabled item is matched by its label prefix, and the
          // presence of a reason is asserted rather than its wording.
          //
          // Scoped to primaryNav, not page-wide: now that this suite
          // runs authenticated, app/page.tsx's own dashboard starting-
          // point cards ALSO render a "Shipments" link in #main, so an
          // unscoped page.getByRole(...) resolves to two elements
          // (found by actually running this suite, not assumed).
          const control =
            role === "button"
              ? primaryNav.getByRole(
                  role,
                  { name: new RegExp(`^${label} \(.+\)$`) },
                )
              : primaryNav.getByRole(
                  role,
                  { name: label, exact: true },
                );

          await expect(control).toBeVisible();

          if (role === "button") {
            await expect(control).toBeDisabled();
          }
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
        // the same kind of build we deploy. Unaffected by this file's
        // shared authenticated session -- the gate applies regardless of
        // who is signed in.
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

        // 2026-09-05 (SME plan v2.1.1, S1). Now that this session is
        // authenticated, "/" no longer redirects -- both navigations
        // below land on real, distinct pages (the dashboard, then the
        // standalone sign-in card, which renders unconditionally
        // regardless of session state; see app/(auth)/sign-in/page.tsx).
        await page.goto(
          "/",
        );

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
      async (
        { page, sharedImporterAuth },
      ) => {
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

        // The org-switcher lives in the topbar's desktop-only region
        // (components/shell/topbar.tsx) -- hidden below `sm`, same as
        // the primary nav below `md`.
        await expect(
          page.getByRole("banner").getByRole(
            "button",
            { name: sharedImporterAuth.organizationName },
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
            { name: sharedImporterAuth.organizationName },
          ),
        ).toBeVisible();
      },
    );

    test(
      "desktop viewport shows the sidebar",
      async (
        { page, sharedImporterAuth },
      ) => {
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

        // 2026-09-05 (SME plan v2.1.1, S1). This test used to assert the
        // org-switcher's ABSENCE, because the suite ran entirely signed
        // out (components/shell/topbar.tsx only renders it for a
        // signed-in user with a real org) -- that was a true fact about
        // a signed-out visitor, not a statement that the org-switcher
        // doesn't work. Now that this file runs against a real
        // authenticated importer org, the meaningful assertion is the
        // other direction: the switcher shows the REAL org name created
        // moments ago by sharedImporterAuth, not a stale placeholder.
        await expect(
          page.getByRole("banner").getByRole(
            "button",
            { name: sharedImporterAuth.organizationName },
          ),
        ).toBeVisible();
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
