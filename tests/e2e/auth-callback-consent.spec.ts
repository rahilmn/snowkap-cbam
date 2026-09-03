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

/**
 * Whether the browser actually holds an authenticated session.
 *
 * Deliberately NOT "does a cookie named sb-* exist". The first version
 * of this suite asserted that and flaked: @supabase/ssr's middleware
 * runs on every request and can write auth cookie chunks -- including
 * empty ones -- without anybody being signed in. Counting cookie names
 * measured the framework's bookkeeping, not the property under test.
 *
 * The property under test is whether a protected route lets you in.
 */
async function isAuthenticated(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  await page.goto("/shipments");

  // Signed out, every product route funnels to sign-in.
  return !page.url().includes("/sign-in");
}

test.describe("auth callback requires explicit consent", () => {
  test(
    "opening the link does not sign anyone in, and shows a Continue step",
    async ({ page }) => {
      await page.goto(
        `/auth/callback#access_token=${FAKE_ACCESS_TOKEN}&refresh_token=${FAKE_REFRESH_TOKEN}&type=invite`,
      );

      await expect(
        page.getByRole("button", { name: "Continue" }),
      ).toBeVisible();

      // The credential is not on the screen.
      const body =
        await page.locator("body").innerText();

      expect(body).not.toContain(FAKE_ACCESS_TOKEN);
      expect(body).not.toContain(FAKE_REFRESH_TOKEN);

      // And the load established nothing: a protected route still
      // refuses.
      expect(await isAuthenticated(page)).toBe(false);
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
    async ({ request, page }) => {
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

      expect(await isAuthenticated(page)).toBe(false);
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
