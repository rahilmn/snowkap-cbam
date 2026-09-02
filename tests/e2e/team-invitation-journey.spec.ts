import {
  expect,
  test,
  type Page,
} from "@playwright/test";

import {
  extractAppLink,
  isMailpitReachable,
  rebaseOrigin,
  waitForEmailTo,
} from "../support/mailpit";

/**
 * The invitation journey a real person walks, end to end, through the
 * real email the stack delivers.
 *
 * This exists because of 2026-09-02. A genuine invitee's token was
 * consumed 76 seconds after delivery by a Chromium client egressing from
 * a Microsoft Azure address -- a corporate mail-security scanner opening
 * the link before the human -- and the human's own click landed on "This
 * link is invalid or has expired." No test in the repository could have
 * caught it: nothing read a delivered email, so nothing knew the link
 * pointed at an endpoint that spends its token on GET.
 *
 * The prefetch simulation below therefore has TWO arms, and the second
 * is the one that matters. A cookie-less APIRequestContext GET proves
 * only that curl cannot consume the token -- which was never in doubt
 * once the exchange moved off the GET path. A real browser context that
 * loads the page, runs its JavaScript and hydrates it is what actually
 * models a Safe Links detonation, and it is what would fail if anyone
 * ever added an auto-submit to the confirm form.
 *
 * Desktop-only, and generous with time: two real browser contexts, two
 * sign-ups, a real email round trip through Mailpit.
 */

test.describe.configure(
  {
    timeout: 300_000,
  },
);

const PASSWORD =
  "Password123!";

const INVITEE_PASSWORD =
  "InviteePassword123!";

async function signUpAndOnboard(
  page: Page,
  {
    email,
    organizationName,
  }: {
    email: string;
    organizationName: string;
  },
): Promise<void> {
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
    PASSWORD,
  );

  await page.getByRole(
    "button",
    { name: "Create account" },
  ).click();

  await expect(page).toHaveURL(
    /\/onboarding$/,
  );

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

  await expect(page).toHaveURL(
    "/",
  );
}

test.describe(
  "team invitation journey: invite -> delivered email -> prefetch-safe link -> set password -> accept",
  () => {
    test(
      "an invitation link survives being opened by a scanner, and the invitee can still accept it",
      async (
        {
          browser,
          request,
          baseURL,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "the Team screen's admin controls and the org-switcher this journey drives are desktop-layout only, same discipline as the sibling journey specs",
        );

        test.skip(
          !(await isMailpitReachable()),
          "requires the Mailpit instance `supabase start` runs; nothing else can show what a recipient actually received",
        );

        const runId =
          crypto.randomUUID().slice(0, 8);

        const adminEmail =
          `invite-admin-${runId}@example.com`;

        const inviteeEmail =
          `invite-invitee-${runId}@example.com`;

        const organizationName =
          `Invite Journey Org ${runId}`;

        const adminContext =
          await browser.newContext();

        const inviteeContext =
          await browser.newContext();

        try {
          const adminPage =
            await adminContext.newPage();

          await test.step(
            "an admin creates an organization and invites a colleague",
            async () => {
              await signUpAndOnboard(
                adminPage,
                { email: adminEmail, organizationName },
              );

              await adminPage.goto(
                "/team",
              );

              await adminPage.getByLabel(
                "Invite by email",
              ).fill(
                inviteeEmail,
              );

              await adminPage.getByRole(
                "button",
                { name: "Send invite" },
              ).click();

              await expect(
                adminPage.getByText(inviteeEmail).first(),
              ).toBeVisible();

              // The admin's own screen must say what state the
              // invitation is in. It has no EXPIRED status in the
              // database, so this wording is the only thing that will
              // ever tell them.
              await expect(
                adminPage.getByText(/Awaiting acceptance/).first(),
              ).toBeVisible();
            },
          );

          const link =
            await test.step(
              "the delivered email links to the application, carrying a token_hash rather than a token GoTrue would spend on GET",
              async () => {
                const delivered =
                  await waitForEmailTo(
                    inviteeEmail,
                  );

                const confirmLink =
                  extractAppLink(
                    delivered,
                    "/auth/confirm",
                  );

                expect(
                  confirmLink.searchParams.get("token_hash"),
                ).toBeTruthy();

                expect(
                  confirmLink.searchParams.get("type"),
                ).toBe(
                  "invite",
                );

                // site_url is 127.0.0.1 and Playwright drives localhost.
                // Same server, separate cookie jars in a browser.
                return rebaseOrigin(
                  confirmLink,
                  baseURL!,
                );
              },
            );

          await test.step(
            "arm 1 -- a cookie-less, JavaScript-free fetch of the link changes nothing",
            async () => {
              const response =
                await request.get(
                  link.toString(),
                );

              expect(response.status()).toBe(
                200,
              );

              expect(await response.text()).toContain(
                "Continue",
              );

              const setCookie =
                response.headersArray().filter(
                  (header) => header.name.toLowerCase() === "set-cookie",
                );

              expect(
                setCookie.filter(
                  (header) => header.value.includes("sb-"),
                ),
              ).toEqual(
                [],
              );
            },
          );

          await test.step(
            "arm 2 -- a real browser loads the page, runs its JavaScript and hydrates it, and STILL does not spend the token",
            async () => {
              // This is the arm that models a mail-security scanner.
              // Arm 1 would keep passing if someone added a useEffect
              // that submitted the form on mount; this one would not.
              const scannerContext =
                await browser.newContext();

              try {
                const scannerPage =
                  await scannerContext.newPage();

                await scannerPage.goto(
                  link.toString(),
                );

                await scannerPage.waitForLoadState(
                  "networkidle",
                );

                await scannerPage.waitForTimeout(
                  2_000,
                );

                expect(
                  (await scannerContext.cookies()).filter(
                    (cookie) => cookie.name.startsWith("sb-"),
                  ),
                ).toEqual(
                  [],
                );

                // Still on the confirm screen -- it never navigated
                // itself onward, which a consumed token would have.
                await expect(
                  scannerPage.getByRole(
                    "button",
                    { name: "Continue" },
                  ),
                ).toBeVisible();
              } finally {
                await scannerContext.close();
              }
            },
          );

          const inviteePage =
            await inviteeContext.newPage();

          await test.step(
            "the invitee opens the same link, presses Continue, sets a password and accepts",
            async () => {
              await inviteePage.goto(
                link.toString(),
              );

              await inviteePage.getByRole(
                "button",
                { name: "Continue" },
              ).click();

              // GoTrue's invite verification confirms the account
              // without the invitee ever choosing a password, so this
              // step is what stops them being locked out later.
              await expect(inviteePage).toHaveURL(
                /\/reset-password/,
              );

              await expect(
                inviteePage.getByText(
                  "Set a password for your new account",
                ),
              ).toBeVisible();

              await inviteePage.getByLabel(
                "New password",
                { exact: true },
              ).fill(
                INVITEE_PASSWORD,
              );

              await inviteePage.getByLabel(
                "Confirm new password",
              ).fill(
                INVITEE_PASSWORD,
              );

              await inviteePage.getByRole(
                "button",
                { name: "Set new password" },
              ).click();

              await expect(inviteePage).toHaveURL(
                /\/accept-invitation/,
              );

              await expect(
                inviteePage.getByText(organizationName).first(),
              ).toBeVisible();

              await inviteePage.getByRole(
                "button",
                { name: "Accept" },
              ).first().click();

              await expect(inviteePage).toHaveURL(
                "/",
              );
            },
          );

          await test.step(
            "the password the invitee chose actually works -- they are not one session expiry from a dead end",
            async () => {
              await inviteePage.goto(
                "/",
              );

              await inviteePage.getByRole(
                "button",
                { name: "Sign out" },
              ).click();

              await expect(inviteePage).toHaveURL(
                /\/sign-in/,
              );

              await inviteePage.getByLabel(
                "Email",
                { exact: true },
              ).fill(
                inviteeEmail,
              );

              await inviteePage.getByLabel(
                "Password",
                { exact: true },
              ).fill(
                INVITEE_PASSWORD,
              );

              await inviteePage.getByRole(
                "button",
                { name: "Sign in" },
              ).click();

              await expect(inviteePage).toHaveURL(
                "/",
              );
            },
          );

          await test.step(
            "a second use of the same link explains what happened and offers both ways back, instead of one dead sentence",
            async () => {
              const secondContext =
                await browser.newContext();

              try {
                const secondPage =
                  await secondContext.newPage();

                await secondPage.goto(
                  link.toString(),
                );

                await secondPage.getByRole(
                  "button",
                  { name: "Continue" },
                ).click();

                await expect(
                  secondPage.getByText(
                    /already been used or has expired/,
                  ),
                ).toBeVisible();

                await expect(
                  secondPage.getByRole(
                    "link",
                    { name: "Sign in" },
                  ),
                ).toBeVisible();

                await expect(
                  secondPage.getByRole(
                    "link",
                    { name: "Set a password" },
                  ),
                ).toBeVisible();
              } finally {
                await secondContext.close();
              }
            },
          );
        } finally {
          await adminContext.close();
          await inviteeContext.close();
        }
      },
    );
  },
);
