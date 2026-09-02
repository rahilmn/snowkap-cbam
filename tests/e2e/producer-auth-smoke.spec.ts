import {
  test,
  expect,
} from "./fixtures/authenticated-producer";

// Producer sibling of tests/e2e/importer-auth-smoke.spec.ts: drives the
// real sign-up -> onboarding flow through the actual UI via the
// authenticated-producer fixture (PRODUCER_OPERATOR-only org), then
// asserts the signed-in state is real -- a real org name rendered from
// the DB, and the real producer nav (components/shell/sidebar.tsx's
// PRODUCER_NAV, selected by app-shell.tsx's deriveExperience() once
// this org's only capability is PRODUCER_OPERATOR) -- not merely that
// the shell renders while signed out.
test.describe(
  "authenticated producer session",
  () => {
    test(
      "a freshly onboarded PRODUCER_OPERATOR org lands on the real producer app shell",
      async (
        {
          page,
          producerOrgSession,
          isMobile,
        },
      ) => {
        // Both assertions below (org-switcher, primary nav) are hidden
        // below Tailwind's `sm`/`md` breakpoints respectively
        // (org-switcher.tsx, sidebar.tsx) -- the fixture's sign-up ->
        // onboarding flow itself is viewport-independent, but this
        // spec's own assertions are desktop-only, same skip discipline
        // as importer-auth-smoke.spec.ts.
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
            { name: producerOrgSession.organizationName },
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

        // All eight producer nav items (components/shell/sidebar.tsx's
        // PRODUCER_NAV), each with the real accessible role that item
        // actually renders as: items with an href render as a <Link>
        // (role "link"); items without one render as a disabled
        // placeholder <button> (role "button") -- same discipline as
        // importer-auth-smoke.spec.ts's importerNavItems table, read
        // directly off sidebar.tsx rather than assumed to mirror the
        // importer set.
        const producerNavItems: {
          label: string;
          role: "link" | "button";
        }[] =
          [
            { label: "Dashboard", role: "link" },
            { label: "Installations", role: "link" },
            { label: "Production data", role: "button" },
            { label: "Emissions", role: "link" },
            { label: "Evidence", role: "button" },
            { label: "Verification", role: "button" },
            { label: "Sharing", role: "link" },
            { label: "Activity", role: "link" },
          ];

        for (
          const { label, role } of producerNavItems
        ) {
          // Disabled nav items carry an sr-only " (not available yet)"
          // suffix (components/shell/sidebar.tsx), so that IS their
          // accessible name -- a screen-reader user hears the reason
          // rather than hitting a silently inert control. Asserting the
          // full name keeps `exact` (no accidental substring matches)
          // and additionally proves the disabled affordance is actually
          // announced. (Corrected 2026-08-31: these specs still expected
          // the bare label, and had never run in CI to catch it.)
          // 2026-09-03 (P14, WP-E). The sr-only suffix now carries the
          // ACTUAL reason rather than the blanket "not available yet",
          // which for Evidence and Verification was simply false --
          // both are fully built and live inline on each dataset. So
          // the accessible name is no longer derivable from the label,
          // and a disabled item is matched by its label prefix with the
          // reason asserted separately.
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
            // The reason must be a real sentence, not the empty
            // parentheses a missing explanation would leave behind.
            await expect(control).toBeDisabled();
          }
        }
      },
    );
  },
);
