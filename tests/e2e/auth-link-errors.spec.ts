import {
  expect,
  test,
} from "@playwright/test";

/**
 * The screens a user lands on when an auth email link does not work.
 *
 * Needs no Supabase and no email: every case here is driven by the URL
 * parameters GoTrue itself redirects back with, which is exactly how a
 * real failure arrives. Runs on both the desktop and mobile projects,
 * because these are the screens a person reaches on whatever device
 * their mail client opened.
 *
 * Until 2026-09-03 all of these rendered one sentence -- "This link is
 * invalid or has expired." -- with no explanation and no next step. A
 * real invitee hit that on 2026-09-02 and could not get past it.
 */
test.describe(
  "auth link failure screens",
  () => {
    test(
      "a spent invitation link explains that scanners open links, and offers both ways back",
      async ({ page }) => {
        await page.goto(
          "/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=invite",
        );

        await expect(
          page.getByText(
            "This invitation link has already been used or has expired",
          ),
        ).toBeVisible();

        await expect(
          page.getByText(
            /Email security scanners sometimes open links before you do/,
          ),
        ).toBeVisible();

        await expect(
          page.getByRole("link", { name: "Sign in" }),
        ).toBeVisible();

        await expect(
          page.getByRole("link", { name: "Set a password" }),
        ).toBeVisible();
      },
    );

    test(
      "the same failure delivered in the query string, as PKCE-flow links carry it, is handled identically",
      async ({ page }) => {
        await page.goto(
          "/auth/callback?error=access_denied&error_code=otp_expired&type=recovery",
        );

        await expect(
          page.getByText(
            "This password reset link has already been used or has expired",
          ),
        ).toBeVisible();
      },
    );

    test(
      "never renders text supplied in the URL, even on a trusted branded origin",
      async ({ page }) => {
        // error_description is attacker-controllable. A crafted link
        // must not be able to put arbitrary wording in front of someone
        // who has every reason to trust the page it appears on.
        await page.goto(
          "/auth/callback#error_code=otp_expired&error_description=Your+account+was+suspended+call+555+1234&type=invite",
        );

        await expect(
          page.getByText(
            "This invitation link has already been used or has expired",
          ),
        ).toBeVisible();

        await expect(
          page.getByText(/555 1234/),
        ).toHaveCount(
          0,
        );
      },
    );

    test(
      "an incomplete confirm link says so, rather than failing silently",
      async ({ page }) => {
        await page.goto(
          "/auth/confirm",
        );

        await expect(
          page.getByText("This link is incomplete"),
        ).toBeVisible();

        await expect(
          page.getByRole("button", { name: "Continue" }),
        ).toHaveCount(
          0,
        );
      },
    );

    test(
      "a confirm link with a type outside the allowlist is refused before anything is exchanged",
      async ({ page }) => {
        await page.goto(
          "/auth/confirm?token_hash=whatever&type=phone_change",
        );

        await expect(
          page.getByText("This link is incomplete"),
        ).toBeVisible();
      },
    );

    test(
      "a well-formed confirm link renders an inert page with an explicit Continue, and no session",
      async ({ page, context }) => {
        // The token is fake, so pressing Continue would fail -- but the
        // point is what happens BEFORE that: the page must render, must
        // ask, and must not have established anything.
        await page.goto(
          "/auth/confirm?token_hash=not-a-real-token&type=invite",
        );

        await expect(
          page.getByRole("button", { name: "Continue" }),
        ).toBeVisible();

        await expect(
          page.getByText(
            /This link can only be used once/,
          ),
        ).toBeVisible();

        expect(
          (await context.cookies()).filter(
            (cookie) => cookie.name.startsWith("sb-"),
          ),
        ).toEqual(
          [],
        );
      },
    );
  },
);
