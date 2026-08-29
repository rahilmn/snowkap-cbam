import {
  test as base,
  expect,
} from "@playwright/test";

import {
  randomUUID,
} from "node:crypto";

/**
 * Reusable Playwright fixture that drives a real, unauthenticated
 * browser through the actual product flow -- sign-up -> onboarding
 * (choosing IMPORTER_DECLARANT) -- and leaves `page` sitting on the
 * real importer app shell, signed in, with a real org. Every step is
 * genuine UI interaction (typed into real form fields, real button
 * clicks); nothing talks to Supabase directly. This is what makes the
 * fixture proof that the signup -> onboarding -> app flow actually
 * works end-to-end, not just that the pieces exist in isolation.
 *
 * Requires local Supabase with `enable_confirmations = false`
 * (supabase/config.toml) so signUpAction's `data.session` is non-null
 * and it redirects straight to /onboarding -- see app/(auth)/actions.ts.
 *
 * Email uses a fresh randomUUID-derived runId per fixture invocation,
 * matching the convention already established across
 * tests/integration/*.test.ts (e.g. organizations-isolation.test.ts),
 * so concurrent/repeated runs never collide on the DB's email
 * uniqueness constraint.
 */
export interface ImporterOrgSession {
  runId: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
}

interface ImporterFixtures {
  importerOrgSession: ImporterOrgSession;
}

export const test =
  base.extend<ImporterFixtures>(
    {
      importerOrgSession: async (
        { page },
        use,
      ) => {
        const runId =
          randomUUID().slice(
            0,
            8,
          );

        const email =
          `e2e-importer-${runId}@example.com`;

        const password =
          "Password123!";

        const organizationName =
          `E2E Importer Org ${runId}`;

        // Mirrors onboarding-form.tsx's own slugify() so the assertion
        // below reflects what the real form actually derives, not a
        // separately-maintained guess.
        const organizationSlug =
          organizationName
            .toLowerCase()
            .trim()
            .replace(
              /[^a-z0-9]+/g,
              "-",
            )
            .replace(
              /^-+|-+$/g,
              "",
            );

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

        // The slug field auto-derives from the name via onChange; left
        // untouched here so the real client-side slugify() runs, same
        // as a genuine user would experience.

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

        await use(
          {
            runId,
            email,
            password,
            organizationName,
            organizationSlug,
          },
        );
      },
    },
  );

export {
  expect,
};
