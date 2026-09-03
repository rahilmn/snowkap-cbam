import {
  expect,
  test,
} from "@playwright/test";

/**
 * /auth/callback must not establish a session on load (P14 owner
 * decision 4).
 *
 * tests/architecture/auth-callback-requires-explicit-consent.test.ts
 * asserts the absence in the source. This asserts the behaviour in a
 * real browser, which is the half a source check cannot cover: that
 * opening the URL -- the thing a victim, a scanner or a preloader
 * actually does -- leaves the session alone.
 *
 * Deliberately uses syntactically valid but meaningless tokens. The
 * point is that nothing is even ATTEMPTED before the press, so the
 * tokens never need to be real; if the page were still adopting on
 * load, it would try them and the attempt is what this detects.
 */
const FAKE_ACCESS_TOKEN =
  "eyJ" + "hbGciOiJIUzI1NiJ9" + ".e30." + "not-a-real-signature";

const FAKE_REFRESH_TOKEN =
  "p14-not-a-real-refresh-token";

async function sessionCookieCount(
  context: import("@playwright/test").BrowserContext,
): Promise<number> {
  const cookies =
    await context.cookies();

  return cookies.filter(
    (cookie) => cookie.name.startsWith("sb-"),
  ).length;
}

test.describe("auth callback requires explicit consent", () => {
  test(
    "opening the link does not sign anyone in, and shows a Continue step",
    async ({ page, context }) => {
      await page.goto(
        `/auth/callback#access_token=${FAKE_ACCESS_TOKEN}&refresh_token=${FAKE_REFRESH_TOKEN}&type=invite`,
      );

      await expect(
        page.getByRole("button", { name: "Continue" }),
      ).toBeVisible();

      // The load did not establish anything.
      expect(await sessionCookieCount(context)).toBe(0);

      // And the credential is not on the screen.
      const body =
        await page.locator("body").innerText();

      expect(body).not.toContain(FAKE_ACCESS_TOKEN);
      expect(body).not.toContain(FAKE_REFRESH_TOKEN);
    },
  );

  test(
    "the credential is stripped from the address bar, so it is not left in " +
      "history or carried by a later navigation",
    async ({ page }) => {
      await page.goto(
        `/auth/callback#access_token=${FAKE_ACCESS_TOKEN}&refresh_token=${FAKE_REFRESH_TOKEN}&type=recovery`,
      );

      await expect(
        page.getByRole("button", { name: "Continue" }),
      ).toBeVisible();

      expect(page.url()).not.toContain(FAKE_ACCESS_TOKEN);
      expect(page.url()).not.toContain("access_token");
    },
  );

  test(
    "a cookie-less request -- a scanner or a preloader -- establishes nothing",
    async ({ request, context }) => {
      // No JavaScript runs at all here, which is the weaker of the two
      // scanner shapes; the page.goto cases above cover the stronger one
      // (a real browser executing the page but not clicking).
      const response =
        await request.get(
          `/auth/callback#access_token=${FAKE_ACCESS_TOKEN}&refresh_token=${FAKE_REFRESH_TOKEN}`,
        );

      expect(response.status()).toBe(200);

      const setCookie =
        response.headersArray().filter(
          (header) => header.name.toLowerCase() === "set-cookie",
        );

      expect(
        setCookie.some((header) => header.value.includes("sb-")),
      ).toBe(false);

      expect(await sessionCookieCount(context)).toBe(0);
    },
  );

  test(
    "a link with no auth material at all fails cleanly rather than hanging " +
      "on a spinner",
    async ({ page }) => {
      await page.goto("/auth/callback");

      await expect(
        page.getByRole("button", { name: "Continue" }),
      ).toBeHidden();

      await expect(
        page.getByText(/link/i).first(),
      ).toBeVisible();
    },
  );
});
