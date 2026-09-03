import { spawnSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  changePasswordForSession,
} from "../../app/account/password/change-password";

import {
  sessionWasEstablishedByEmailLink,
} from "../../app/auth/session-assurance";

/**
 * AUTH-1: a stolen session must not be able to change a password.
 *
 * THE CONFIRMED FINDING, reproduced here before it is closed. With
 * `secure_password_change = true` on a real GoTrue v2.195.0:
 *
 *   aged session   -> PUT /auth/v1/user {password} -> 400 reauthentication_needed
 *   FRESH session  -> PUT /auth/v1/user {password} -> 200  <- the takeover
 *
 * A session cookie lifted from a live browser is fresh by definition,
 * so the hosted control covers the case that matters least. From there
 * the attacker owns the account: the legitimate password stops working
 * and `logout?scope=others` evicts the owner's remaining sessions.
 *
 * Both arms are measured here rather than asserted, including the one
 * that still succeeds -- because the point of this suite is that the
 * APPLICATION is what refuses, and that claim is only meaningful while
 * it is visible that GoTrue underneath would not have.
 *
 * What is under test is the product's own boundary
 * (app/account/password/change-password.ts, and the email-link gate on
 * /reset-password), driven here against real Auth with real passwords
 * and a real stolen session -- not a re-implementation of it. The
 * branch-by-branch behaviour is pinned in the two unit suites; this is
 * the live half.
 */

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LOCAL_DB_URL =
  process.env.SUPABASE_LOCAL_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function isLocalSupabaseReachable(): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${LOCAL_API_URL}/auth/v1/health`,
        {
          signal:
            AbortSignal.timeout(
              1500,
            ),
        },
      );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * psql rather than a new npm dependency, exactly as
 * scripts/ops/compare-database-posture.mjs does and for the same stated
 * reason. It is on PATH in CI (.github/workflows/ci.yml runs it
 * directly) and is needed for one thing only: backdating a session so
 * the AGED arm of the matrix is genuinely aged rather than assumed.
 */
function psqlAvailable(): boolean {
  const result =
    spawnSync(
      "psql",
      ["--version"],
      { encoding: "utf8" },
    );

  return !result.error && result.status === 0;
}

function sql(
  statement: string,
): string {
  const result =
    spawnSync(
      "psql",
      [
        LOCAL_DB_URL,
        "-tA",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        statement,
      ],
      { encoding: "utf8" },
    );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `psql exited ${result.status}: ${(result.stderr || "").trim()}`,
    );
  }

  return result.stdout.trim();
}

const ready =
  (await isLocalSupabaseReachable()) &&
  psqlAvailable();

describe.skipIf(!ready)(
  "AUTH-1: changing a password requires proof of the current one (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(
        0,
        8,
      );

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );

    const createdUserIds: string[] =
      [];

    function anonClient(): SupabaseClient {
      return createClient(
        LOCAL_API_URL,
        LOCAL_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
      );
    }

    const ORIGINAL = "OriginalPassw0rd";
    const ATTACKER_CHOICE = "AttackerOwnsThis1";

    beforeAll(() => {
      // verifyCurrentPassword reads the same public env the session
      // client does, so the credential is checked against the very
      // project the session came from.
      process.env.NEXT_PUBLIC_SUPABASE_URL =
        LOCAL_API_URL;

      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
        LOCAL_ANON_KEY;
    });

    afterAll(async () => {
      for (const id of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    async function createVictim(
      label: string,
    ): Promise<{ id: string; email: string }> {
      const email =
        `p14.auth1.${label}.${runId}@snowkaptest.dev`;

      const {
        data,
        error,
      } = await serviceClient.auth.admin.createUser(
        {
          email,
          password: ORIGINAL,
          email_confirm: true,
        },
      );

      if (error || !data.user) {
        throw error ?? new Error("victim not created");
      }

      createdUserIds.push(
        data.user.id,
      );

      return {
        id: data.user.id,
        email,
      };
    }

    /**
     * A client holding a session the way an attacker holds a stolen
     * cookie: the tokens were lifted from somewhere else and installed,
     * never earned by this client.
     */
    async function stealSession(
      email: string,
      password: string,
    ): Promise<{ client: SupabaseClient; accessToken: string; sessionId: string }> {
      const victimBrowser =
        anonClient();

      const {
        data,
        error,
      } = await victimBrowser.auth.signInWithPassword(
        {
          email,
          password,
        },
      );

      if (error || !data.session) {
        throw error ?? new Error("no session");
      }

      const attacker =
        anonClient();

      await attacker.auth.setSession(
        {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      );

      const sessionId =
        JSON.parse(
          Buffer.from(
            data.session.access_token.split(".")[1] ?? "",
            "base64url",
          ).toString("utf8"),
        ).session_id as string;

      return {
        client: attacker,
        accessToken: data.session.access_token,
        sessionId,
      };
    }

    async function passwordWorks(
      email: string,
      password: string,
    ): Promise<boolean> {
      const {
        data,
      } = await anonClient().auth.signInWithPassword(
        {
          email,
          password,
        },
      );

      return Boolean(data.session);
    }

    /**
     * The raw GoTrue capability, with no application in the way. This
     * is the attack surface the product's boundary sits in front of.
     */
    async function rawPasswordChange(
      accessToken: string,
      password: string,
    ): Promise<{ status: number; code?: string }> {
      const response =
        await fetch(
          `${LOCAL_API_URL}/auth/v1/user`,
          {
            method: "PUT",
            headers: {
              apikey: LOCAL_ANON_KEY,
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(
              { password },
            ),
          },
        );

      const body =
        await response.json().catch(
          () => null,
        );

      return {
        status: response.status,
        code: body?.error_code ?? body?.code,
      };
    }

    function ageSession(
      sessionId: string,
    ): void {
      sql(
        `update auth.sessions set created_at = now() - interval '30 days', ` +
          `updated_at = now() - interval '30 days', ` +
          `refreshed_at = now() - interval '30 days' where id = '${sessionId}'`,
      );
    }

    // ---------------------------------------------------------------
    // The finding, reproduced. Not a formality: if GoTrue ever starts
    // refusing a fresh session on its own, this fails and tells us the
    // ground moved.
    // ---------------------------------------------------------------

    it(
      "reproduces the finding: at the GoTrue layer a FRESH stolen session still rewrites the password, while an AGED one is refused",
      async () => {
        const victim =
          await createVictim("raw");

        const fresh =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        expect(
          (
            await rawPasswordChange(
              fresh.accessToken,
              ATTACKER_CHOICE,
            )
          ).status,
        ).toBe(
          200,
        );

        // Put it back, then do the aged arm from a known state.
        await serviceClient.auth.admin.updateUserById(
          victim.id,
          { password: ORIGINAL },
        );

        const aged =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        ageSession(
          aged.sessionId,
        );

        expect(
          await rawPasswordChange(
            aged.accessToken,
            ATTACKER_CHOICE,
          ),
        ).toEqual(
          {
            status: 400,
            code: "reauthentication_needed",
          },
        );

        await serviceClient.auth.admin.updateUserById(
          victim.id,
          { password: ORIGINAL },
        );
      },
    );

    // ---------------------------------------------------------------
    // The attack matrix, against the application's own boundary.
    // ---------------------------------------------------------------

    it(
      "4. a FRESH stolen session with no current password changes nothing, and the owner keeps the account",
      async () => {
        const victim =
          await createVictim("fresh");

        const attacker =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        const outcome =
          await changePasswordForSession(
            attacker.client,
            {
              currentPassword: "",
              newPassword: ATTACKER_CHOICE,
            },
          );

        expect(outcome).toEqual(
          { status: "CURRENT_PASSWORD_INCORRECT" },
        );

        // Password unchanged.
        expect(
          await passwordWorks(
            victim.email,
            ORIGINAL,
          ),
        ).toBe(true);

        // The attacker did not become the owner.
        expect(
          await passwordWorks(
            victim.email,
            ATTACKER_CHOICE,
          ),
        ).toBe(false);

        // And the legitimate session is still valid -- the refusal did
        // not sign anybody out, which is what `scope: "others"` would
        // have done had it run.
        const {
          data: { user },
        } = await attacker.client.auth.getUser();

        expect(user?.id).toBe(
          victim.id,
        );
      },
    );

    it(
      "5. an AGED stolen session is refused by the application before GoTrue's own control is ever consulted",
      async () => {
        const victim =
          await createVictim("aged");

        const attacker =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        ageSession(
          attacker.sessionId,
        );

        // Recorded before the attempt so "GoTrue was never asked" is a
        // measurement rather than an inference: a refused update leaves
        // the user row untouched.
        const before =
          sql(
            `select updated_at from auth.users where id = '${victim.id}'`,
          );

        expect(
          await changePasswordForSession(
            attacker.client,
            {
              currentPassword: "",
              newPassword: ATTACKER_CHOICE,
            },
          ),
        ).toEqual(
          { status: "CURRENT_PASSWORD_INCORRECT" },
        );

        expect(
          sql(
            `select updated_at from auth.users where id = '${victim.id}'`,
          ),
        ).toBe(
          before,
        );

        expect(
          await passwordWorks(
            victim.email,
            ORIGINAL,
          ),
        ).toBe(true);
      },
    );

    it(
      "2. a WRONG current password is refused, however many times it is guessed",
      async () => {
        const victim =
          await createVictim("wrong");

        const attacker =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        for (
          const guess of [
            "OriginalPassw0r",
            "originalpassw0rd",
            "OriginalPassw0rd ",
            " OriginalPassw0rd",
            ATTACKER_CHOICE,
          ]
        ) {
          expect(
            await changePasswordForSession(
              attacker.client,
              {
                currentPassword: guess,
                newPassword: ATTACKER_CHOICE,
              },
            ),
          ).toEqual(
            { status: "CURRENT_PASSWORD_INCORRECT" },
          );
        }

        expect(
          await passwordWorks(
            victim.email,
            ORIGINAL,
          ),
        ).toBe(true);

        expect(
          await passwordWorks(
            victim.email,
            ATTACKER_CHOICE,
          ),
        ).toBe(false);
      },
    );

    it(
      "1/8. the legitimate change succeeds: the new password works, the old one stops, and other sessions are evicted",
      async () => {
        const victim =
          await createVictim("legit");

        const NEW_PASSWORD = "BrandNewPassw0rd";

        // Two sessions: the one the user is standing in, and another
        // device -- which stands in for the attacker's stolen cookie.
        const standing =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        const otherDevice =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        expect(
          await changePasswordForSession(
            standing.client,
            {
              currentPassword: ORIGINAL,
              newPassword: NEW_PASSWORD,
            },
          ),
        ).toEqual(
          {
            status: "CHANGED",
            otherSessionsSignedOut: true,
          },
        );

        expect(
          await passwordWorks(
            victim.email,
            NEW_PASSWORD,
          ),
        ).toBe(true);

        expect(
          await passwordWorks(
            victim.email,
            ORIGINAL,
          ),
        ).toBe(false);

        // The session the change was made from survives.
        const {
          data: { user },
        } = await standing.client.auth.getUser();

        expect(user?.id).toBe(
          victim.id,
        );

        // The other one does not: its refresh token is gone, which is
        // what actually evicts a stolen cookie once its short-lived
        // access token expires.
        const {
          error: refreshError,
        } = await anonClient().auth.refreshSession(
          {
            refresh_token:
              (
                await otherDevice.client.auth.getSession()
              ).data.session?.refresh_token ?? "",
          },
        );

        expect(refreshError).not.toBeNull();
      },
    );

    it(
      "7. the proof is not replayable: a successful change leaves no reusable capability behind",
      async () => {
        const victim =
          await createVictim("replay");

        const FIRST_NEW = "FirstNewPassw0rd";
        const SECOND_NEW = "SecondNewPassw0rd";

        const session =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        expect(
          (
            await changePasswordForSession(
              session.client,
              {
                currentPassword: ORIGINAL,
                newPassword: FIRST_NEW,
              },
            )
          ).status,
        ).toBe(
          "CHANGED",
        );

        // Immediately afterwards, on the very same session, the
        // now-stale current password is refused. Nothing was cached, no
        // "recently authenticated" flag was set, and the assurance did
        // not outlive the request that earned it.
        expect(
          await changePasswordForSession(
            session.client,
            {
              currentPassword: ORIGINAL,
              newPassword: SECOND_NEW,
            },
          ),
        ).toEqual(
          { status: "CURRENT_PASSWORD_INCORRECT" },
        );

        expect(
          await passwordWorks(
            victim.email,
            SECOND_NEW,
          ),
        ).toBe(false);

        // The current password still works, so the capability is the
        // credential and only the credential.
        expect(
          (
            await changePasswordForSession(
              session.client,
              {
                currentPassword: FIRST_NEW,
                newPassword: SECOND_NEW,
              },
            )
          ).status,
        ).toBe(
          "CHANGED",
        );
      },
    );

    it(
      "verifying a password neither replaces the caller's session nor leaves a live one behind",
      async () => {
        const victim =
          await createVictim("hygiene");

        const session =
          await stealSession(
            victim.email,
            ORIGINAL,
          );

        const before =
          Number(
            sql(
              `select count(*) from auth.sessions where user_id = '${victim.id}'`,
            ),
          );

        expect(
          await changePasswordForSession(
            session.client,
            {
              currentPassword: "wrong-on-purpose",
              newPassword: "Unus3dPassword",
            },
          ),
        ).toEqual(
          { status: "CURRENT_PASSWORD_INCORRECT" },
        );

        // A refused verification mints nothing.
        expect(
          Number(
            sql(
              `select count(*) from auth.sessions where user_id = '${victim.id}'`,
            ),
          ),
        ).toBe(
          before,
        );

        expect(
          await changePasswordForSession(
            session.client,
            {
              currentPassword: ORIGINAL,
              newPassword: "Unus3dPassword",
            },
          ),
        ).toEqual(
          {
            status: "CHANGED",
            otherSessionsSignedOut: true,
          },
        );

        // A successful one mints a verification session and revokes it,
        // so the only session left is the caller's own -- which
        // scope:"others" deliberately spares.
        expect(
          Number(
            sql(
              `select count(*) from auth.sessions where user_id = '${victim.id}'`,
            ),
          ),
        ).toBe(
          1,
        );

        expect(
          sql(
            `select id from auth.sessions where user_id = '${victim.id}'`,
          ),
        ).toBe(
          session.sessionId,
        );
      },
    );

    // ---------------------------------------------------------------
    // The other reachable password-setting path.
    // ---------------------------------------------------------------

    it(
      "/reset-password's gate reads real GoTrue claims: a password session is refused, a recovery session is not",
      async () => {
        const victim =
          await createVictim("claims");

        // The stolen-cookie shape.
        const {
          data: passwordSession,
        } = await anonClient().auth.signInWithPassword(
          {
            email: victim.email,
            password: ORIGINAL,
          },
        );

        const decode =
          (token: string) =>
            JSON.parse(
              Buffer.from(
                token.split(".")[1] ?? "",
                "base64url",
              ).toString("utf8"),
            );

        expect(
          sessionWasEstablishedByEmailLink(
            decode(
              passwordSession.session?.access_token ?? "",
            ),
          ),
        ).toBe(false);

        // The shape the screen exists for.
        const {
          data: link,
          error: linkError,
        } = await serviceClient.auth.admin.generateLink(
          {
            type: "recovery",
            email: victim.email,
          },
        );

        if (linkError) {
          throw linkError;
        }

        const recoveryClient =
          anonClient();

        const {
          data: recoverySession,
          error: verifyError,
        } = await recoveryClient.auth.verifyOtp(
          {
            token_hash: link.properties.hashed_token,
            type: "recovery",
          },
        );

        if (verifyError) {
          throw verifyError;
        }

        expect(
          sessionWasEstablishedByEmailLink(
            decode(
              recoverySession.session?.access_token ?? "",
            ),
          ),
        ).toBe(true);

        // And it survives a refresh, so the marker is a property of the
        // session rather than of one token.
        const {
          data: refreshed,
        } = await recoveryClient.auth.refreshSession(
          {
            refresh_token:
              recoverySession.session?.refresh_token ?? "",
          },
        );

        expect(
          sessionWasEstablishedByEmailLink(
            decode(
              refreshed.session?.access_token ?? "",
            ),
          ),
        ).toBe(true);
      },
    );
  },
);
