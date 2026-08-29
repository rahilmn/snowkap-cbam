import {
  test,
  expect,
} from "./fixtures/authenticated-importer";

// Companion to tests/e2e/shell.spec.ts's own signed-out nav-items test
// (see that file's "responsive -> desktop viewport shows the sidebar"
// comment, which explicitly tracks this as follow-up work): this spec
// drives the real sign-up -> onboarding flow through the actual UI via
// the authenticated-importer fixture, then asserts the signed-in state
// is real -- a real org name rendered from the DB, and the real
// importer nav -- not merely that the shell renders while signed out.
test.describe(
  "authenticated importer session",
  () => {
    test(
      "a freshly onboarded IMPORTER_DECLARANT org lands on the real importer app shell",
      async (
        {
          page,
          importerOrgSession,
          isMobile,
        },
      ) => {
        // Both assertions below (org-switcher, primary nav) are hidden
        // below Tailwind's `sm`/`md` breakpoints respectively
        // (org-switcher.tsx, sidebar.tsx) -- the fixture's sign-up ->
        // onboarding flow itself is viewport-independent, but this
        // spec's own assertions are desktop-only, same skip discipline
        // as shell.spec.ts's equivalent tests.
        test.skip(
          isMobile,
          "org-switcher and primary nav are hidden below sm/md -- not covered by this smoke test",
        );

        // The org-switcher (components/shell/topbar.tsx ->
        // components/shell/org-switcher.tsx) only renders once
        // organizationName/currentOrgId/organizations are all present
        // -- i.e. only for a real signed-in user with a real org. A
        // single-org user gets a disabled button whose visible text is
        // the organization's actual name, proving this is the real org
        // created moments ago through the real onboarding form, not a
        // stale placeholder.
        await expect(
          page.getByRole(
            "banner",
          ).getByRole(
            "button",
            { name: importerOrgSession.organizationName },
          ),
        ).toBeVisible();

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        await expect(
          primaryNav,
        ).toBeVisible();

        // All nine importer nav items (docs/plans/MASTER_PLAN.md §7),
        // matching shell.spec.ts's own "all nine importer nav items"
        // test -- but each item's real accessible role, per
        // components/shell/sidebar.tsx: items with an href render as a
        // <Link> (role "link"); items without one render as a disabled
        // placeholder <button> (role "button"). shell.spec.ts's own
        // version of this test asserts role "button" for every item,
        // which does not match the six items that render as links --
        // that pre-existing mismatch was confirmed by actually running
        // that spec (it fails independently of this change) and is out
        // of this fixture's scope to fix.
        const importerNavItems: {
          label: string;
          role: "link" | "button";
        }[] =
          [
            { label: "Dashboard", role: "button" },
            { label: "Shipments", role: "link" },
            { label: "Emissions", role: "link" },
            { label: "Calculations", role: "button" },
            { label: "Suppliers", role: "link" },
            { label: "Installations", role: "button" },
            { label: "Audit", role: "link" },
            { label: "Reports", role: "link" },
            { label: "Declarations", role: "link" },
          ];

        for (
          const { label, role } of importerNavItems
        ) {
          await expect(
            primaryNav.getByRole(
              role,
              { name: label, exact: true },
            ),
          ).toBeVisible();
        }
      },
    );
  },
);
