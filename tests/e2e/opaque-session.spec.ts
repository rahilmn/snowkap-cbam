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
