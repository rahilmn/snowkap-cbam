import {
  test,
  expect,
} from "./fixtures/authenticated-importer";

/**
 * AUTH-1 in a real browser: a signed-in session is not permission to
 * change a password.
 *
 * The unit suites pin the branching and
 * tests/integration/password-change-current-password-proof.test.ts
 * proves the boundary against real GoTrue. This proves the half neither
 * can: that the two REACHABLE screens behave that way when a real
 * browser holding a real session actually visits them -- which is
 * exactly what an attacker with a stolen cookie does.
 *
 * The fixture's session is established by signing up and signing in, so
 * it carries `amr: [{ method: "password" }]` -- the same shape a stolen
 * cookie has. That is what makes it the right session to attack with.
 */
test.describe.configure(
  {
    timeout: 120_000,
  },
);

test.describe(
  "changing a password requires the current one",
  () => {
    test(
      "an ordinary session cannot use the recovery screen to set a password",
      // importerOrgSession is requested for its SIDE EFFECT: Playwright
      // sets fixtures up lazily, so a test that does not name it runs
      // signed OUT -- and a signed-out visitor legitimately sees the
      // password form here, which would make this test pass for exactly
      // the wrong reason.
      async ({ page, importerOrgSession }) => {
        expect(importerOrgSession.email).toBeTruthy();

        // The AUTH-1 path, before any form is filled in: /reset-password
        // used to accept any session at all.
        await page.goto(
          "/reset-password",
        );

        await expect(
          page.getByText(
            "This screen needs an emailed link",
          ),
        ).toBeVisible();

        // No password form is offered at all.
        await expect(
          page.getByLabel(
            "New password",
          ),
        ).toBeHidden();

        // And the screen points at the two honest ways forward.
        await expect(
          page.getByRole(
            "link",
            { name: "Change password" },
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "link",
            { name: "password-reset email" },
          ),
        ).toBeVisible();
      },
    );

    test(
      "the change-password screen asks for the current password, with real labels and password inputs",
      async ({ page, importerOrgSession }) => {
        expect(importerOrgSession.email).toBeTruthy();

        await page.goto(
          "/account/password",
        );

        const current =
          page.getByLabel(
            "Current password",
            { exact: true },
          );

        await expect(current).toBeVisible();

        await expect(current).toHaveAttribute(
          "type",
          "password",
        );

        await expect(current).toHaveAttribute(
          "autocomplete",
          "current-password",
        );

        for (
          const label of [
            "New password",
            "Confirm new password",
          ]
        ) {
          await expect(
            page.getByLabel(
              label,
              { exact: true },
            ),
          ).toHaveAttribute(
            "type",
            "password",
          );
        }

        // Nothing is focused into on load, so a stray keypress cannot
        // submit a half-filled credential form.
        expect(
          await page.evaluate(
            () => document.activeElement?.tagName.toLowerCase() ?? "",
          ),
        ).not.toBe(
          "input",
        );

        // The screen says why the field is there.
        await expect(
          page.getByText(
            "Being signed in is not enough",
          ),
        ).toBeVisible();
      },
    );

    test(
      "a wrong current password is refused and nothing changes",
      async ({ page, importerOrgSession }) => {
        await page.goto(
          "/account/password",
        );

        await page.getByLabel(
          "Current password",
          { exact: true },
        ).fill(
          "not-the-current-password",
        );

        await page.getByLabel(
          "New password",
          { exact: true },
        ).fill(
          "AttackerOwnsThis1",
        );

        await page.getByLabel(
          "Confirm new password",
          { exact: true },
        ).fill(
          "AttackerOwnsThis1",
        );

        await page.getByRole(
          "button",
          { name: "Change password" },
        ).click();

        await expect(
          page.getByText(
            "Your current password is incorrect.",
          ),
        ).toBeVisible();

        // No success notice, and the form is still standing.
        await expect(
          page.getByText(
            "Your password has been changed.",
          ),
        ).toBeHidden();

        // The real password still works: sign out, sign back in with it.
        await page.getByRole(
          "button",
          { name: "Sign out" },
        ).click();

        await page.waitForURL(
          /\/sign-in/,
        );

        await page.getByLabel(
          "Email",
        ).fill(
          importerOrgSession.email,
        );

        await page.getByLabel(
          "Password",
          { exact: true },
        ).fill(
          importerOrgSession.password,
        );

        await page.getByRole(
          "button",
          { name: "Sign in" },
        ).click();

        await expect(page).not.toHaveURL(
          /\/sign-in/,
        );
      },
    );

    test(
      "the correct current password changes it, and the new one is what works afterwards",
      async ({ page, importerOrgSession }) => {
        const newPassword =
          `Changed${importerOrgSession.runId}1`;

        await page.goto(
          "/account/password",
        );

        await page.getByLabel(
          "Current password",
          { exact: true },
        ).fill(
          importerOrgSession.password,
        );

        await page.getByLabel(
          "New password",
          { exact: true },
        ).fill(
          newPassword,
        );

        await page.getByLabel(
          "Confirm new password",
          { exact: true },
        ).fill(
          newPassword,
        );

        await page.getByRole(
          "button",
          { name: "Change password" },
        ).click();

        await expect(
          page.getByText(
            "Your password has been changed.",
          ),
        ).toBeVisible();

        // The credential is not in the URL.
        expect(page.url()).not.toContain(
          newPassword,
        );

        expect(page.url()).not.toContain(
          importerOrgSession.password,
        );

        // This session survived its own password change.
        await page.goto(
          "/shipments",
        );

        await expect(page).not.toHaveURL(
          /\/sign-in/,
        );

        // The new password is the one that works now.
        await page.getByRole(
          "button",
          { name: "Sign out" },
        ).click();

        await page.waitForURL(
          /\/sign-in/,
        );

        await page.getByLabel(
          "Email",
        ).fill(
          importerOrgSession.email,
        );

        await page.getByLabel(
          "Password",
          { exact: true },
        ).fill(
          importerOrgSession.password,
        );

        await page.getByRole(
          "button",
          { name: "Sign in" },
        ).click();

        await expect(
          page.getByText(
            "Incorrect email or password.",
          ),
        ).toBeVisible();

        // Both fields again: React clears an uncontrolled form once its
        // action resolves, so the email is empty by now and refilling
        // only the password would submit an empty address.
        await page.getByLabel(
          "Email",
        ).fill(
          importerOrgSession.email,
        );

        await page.getByLabel(
          "Password",
          { exact: true },
        ).fill(
          newPassword,
        );

        await page.getByRole(
          "button",
          { name: "Sign in" },
        ).click();

        await expect(page).not.toHaveURL(
          /\/sign-in/,
        );
      },
    );
  },
);
