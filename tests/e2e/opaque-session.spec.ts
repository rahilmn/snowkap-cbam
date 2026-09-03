import {
  test,
  expect,
} from "./fixtures/authenticated-importer";

/**
 * The browser session credential is not a Supabase credential
 * (P14, AUTH-1).
 *
 * WHAT THIS EXISTS TO CATCH, stated as the attack it reproduces. Before
 * 2026-09-04 the session cookie was @supabase/ssr's own: a base64 blob
 * that parsed straight into { access_token, refresh_token, user }. A
 * stolen cookie therefore yielded a bearer token that Supabase Auth
 * accepted -- measured, `PUT /auth/v1/user {password}` returned 200
 * with no apikey header at all -- and the victim was locked out of
 * their own account. The application's current-password proof was never
 * defeated; it was bypassed, because the attacker did not need the
 * application.
 *
 * A source check cannot prove the fix. The claim is about what a real
 * browser is actually holding after a real sign-in, so this reads the
 * real cookie jar and takes the values to Supabase Auth itself.
 *
 * A stolen opaque cookie still authenticates to THIS application as the
 * user -- that is inherent to any session cookie and is deliberately
 * not what this suite asserts. What it asserts is that the cookie is
 * useless anywhere else.
 */

const SUPABASE_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/**
 * Every way a cookie value might be hiding a provider session: raw
 * JSON, the `base64-` form @supabase/ssr uses, bare base64, and URL
 * encoding. Deliberately not "does it start with sb-" -- the point is
 * that NO cookie, whatever its name, carries these.
 */
function couldContainProviderCredentials(
  value: string,
): boolean {
  const candidates = [value];

  const withoutPrefix =
    value.startsWith("base64-")
      ? value.slice("base64-".length)
      : value;

  for (const encoded of [withoutPrefix, value]) {
    try {
      candidates.push(
        Buffer.from(encoded, "base64").toString("utf8"),
      );
    } catch {
      // not base64; nothing to add
    }
  }

  try {
    candidates.push(decodeURIComponent(value));
  } catch {
    // not percent-encoded; nothing to add
  }

  return candidates.some(
    (candidate) =>
      candidate.includes("access_token") ||
      candidate.includes("refresh_token") ||
      // A bare JWT would be a provider credential all by itself.
      /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./.test(candidate),
  );
}

async function attemptDirectPasswordChange(
  headers: Record<string, string>,
): Promise<number> {
  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          { password: "AttackerOwnsThis1" },
        ),
      },
    );

  return response.status;
}

test.describe.configure(
  {
    timeout: 120_000,
  },
);

test.describe(
  "the browser session credential is not a Supabase credential",
  () => {
    test(
      "no cookie in the jar carries an access token, a refresh token, or any JWT",
      async ({ context, importerOrgSession }) => {
        expect(importerOrgSession.email).toBeTruthy();

        const cookies =
          await context.cookies();

        expect(cookies.length).toBeGreaterThan(0);

        const carrying =
          cookies.filter(
            (cookie) =>
              couldContainProviderCredentials(cookie.value),
          );

        expect(
          carrying.map((cookie) => cookie.name),
        ).toEqual([]);
      },
    );

    test(
      "the session cookie is opaque, httpOnly, and unreadable from the page",
      async ({ page, context, importerOrgSession }) => {
        expect(importerOrgSession.email).toBeTruthy();

        const cookies =
          await context.cookies();

        const session =
          cookies.find(
            (cookie) => cookie.name === "sb_app_session",
          );

        expect(session).toBeDefined();

        expect(session?.httpOnly).toBe(true);

        // 32 random bytes, base64url, no padding.
        expect(session?.value).toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );

        const visibleToScripts =
          await page.evaluate(
            () => document.cookie,
          );

        expect(visibleToScripts).not.toContain(
          "sb_app_session",
        );
      },
    );

    test(
      "the stolen session cookie cannot authenticate to Supabase Auth at all",
      async ({ context, importerOrgSession }) => {
        expect(importerOrgSession.email).toBeTruthy();

        const cookies =
          await context.cookies();

        const session =
          cookies.find(
            (cookie) => cookie.name === "sb_app_session",
          );

        const stolen =
          session?.value ?? "";

        expect(stolen).not.toBe("");

        // Every shape the value could be presented in. 200 on any of
        // these is the takeover.
        const attempts: Record<string, string>[] = [
          { authorization: `Bearer ${stolen}`, apikey: ANON_KEY },
          { authorization: `Bearer ${stolen}` },
          { apikey: stolen },
          { authorization: `Bearer ${stolen}`, apikey: stolen },
        ];

        for (const headers of attempts) {
          expect(
            await attemptDirectPasswordChange(headers),
          ).not.toBe(
            200,
          );
        }

        // And the account is untouched: the real password still works.
        const signIn =
          await fetch(
            `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
            {
              method: "POST",
              headers: {
                apikey: ANON_KEY,
                "content-type": "application/json",
              },
              body: JSON.stringify(
                {
                  email: importerOrgSession.email,
                  password: importerOrgSession.password,
                },
              ),
            },
          );

        expect(signIn.status).toBe(200);
      },
    );

    test(
      "a planted session identifier never becomes the victim's session (P14 session fixation)",
      async ({ browser, importerOrgSession, page, context }) => {
        // THE ATTACK, end to end in real browsers.
        //
        // Before the fix: an attacker signed in, planted their own
        // identifier as an ordinary cookie in a signed-out victim's
        // browser, the victim signed in, and persistAppSession rebound
        // that row to the victim WITHOUT rotating the identifier -- so
        // the attacker's copy was now the victim's session. Measured:
        // "identifier ROTATED on authentication: false", and the
        // replaying browser rendered "Signed in as <victim>".
        //
        // The fixture's user is the ATTACKER here: it is the one whose
        // identifier gets planted.
        const planted =
          (await context.cookies()).find(
            (cookie) => cookie.name === "sb_app_session",
          )?.value ?? "";

        expect(planted).not.toBe("");

        // Confirm the attacker's own session is genuinely live, so a
        // later refusal cannot be explained by it having been dead all
        // along.
        await page.goto("/shipments");
        await expect(page).not.toHaveURL(/\/sign-in/);

        // A second, signed-out browser: the victim. The identifier is
        // planted as a NON-httpOnly cookie, which is what a script on
        // the origin can write -- a signed-out browser holds no
        // httpOnly cookie of that name, so there is nothing to refuse.
        const victimContext =
          await browser.newContext();

        await victimContext.addCookies(
          [
            {
              name: "sb_app_session",
              value: planted,
              domain: "localhost",
              path: "/",
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
        );

        const victimPage =
          await victimContext.newPage();

        // The victim signs up and in through the real UI, carrying the
        // planted identifier the whole way.
        const victimEmail =
          `e2e-fixation-victim-${importerOrgSession.runId}@example.com`;

        const victimPassword =
          "Password123!";

        await victimPage.goto("/sign-up");

        await victimPage.getByLabel(
          "Email",
          { exact: true },
        ).fill(victimEmail);

        await victimPage.getByLabel(
          "Password",
          { exact: true },
        ).fill(victimPassword);

        await victimPage.getByRole(
          "button",
          { name: "Create account" },
        ).click();

        await expect(victimPage).toHaveURL(
          /\/onboarding$/,
        );

        // F. The identifier the victim now holds is NOT the planted one.
        const victimToken =
          (await victimContext.cookies()).find(
            (cookie) => cookie.name === "sb_app_session",
          )?.value ?? "";

        expect(victimToken).not.toBe("");
        expect(victimToken).not.toBe(planted);

        // H/I. The attacker replays the identifier they planted. It must
        // not authenticate as the victim -- and, because the identifier
        // was retired rather than left alone, not as the attacker
        // either.
        const replayContext =
          await browser.newContext();

        await replayContext.addCookies(
          [
            {
              name: "sb_app_session",
              value: planted,
              domain: "localhost",
              path: "/",
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
        );

        const replayPage =
          await replayContext.newPage();

        await replayPage.goto("/account/password");

        await expect(replayPage).toHaveURL(
          /\/sign-in/,
        );

        const replayBody =
          await replayPage.locator("body").innerText();

        expect(replayBody).not.toContain(victimEmail);
        expect(replayBody).not.toContain(importerOrgSession.email);

        // J. The victim's own fresh identifier works, and is theirs.
        const victimReplay =
          await browser.newContext();

        await victimReplay.addCookies(
          [
            {
              name: "sb_app_session",
              value: victimToken,
              domain: "localhost",
              path: "/",
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
        );

        const victimReplayPage =
          await victimReplay.newPage();

        await victimReplayPage.goto("/account/password");

        await expect(
          victimReplayPage.getByText(victimEmail),
        ).toBeVisible();

        await replayContext.close();
        await victimReplay.close();
        await victimContext.close();
      },
    );

    test(
      "signing out revokes the session on the server, so a copy of the cookie is already dead",
      async ({ page, context, browser, importerOrgSession }) => {
        expect(importerOrgSession.email).toBeTruthy();

        // What an attacker would have taken a moment before.
        const stolenCookies =
          await context.cookies();

        await page.getByRole(
          "button",
          { name: "Sign out" },
        ).click();

        await page.waitForURL(
          /\/sign-in/,
        );

        // Replay the copy. Revocation is server-side, so deleting the
        // browser's own cookie is not what makes this fail.
        const replay =
          await browser.newContext();

        await replay.addCookies(stolenCookies);

        const replayPage =
          await replay.newPage();

        await replayPage.goto(
          "/shipments",
        );

        await expect(replayPage).toHaveURL(
          /\/sign-in/,
        );

        await replay.close();
      },
    );
  },
);
