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

/**
 * The server-side session store, against real Postgres (P14, AUTH-1).
 *
 * The E2E suite proves the browser-facing half -- that the cookie is
 * opaque and useless at Supabase Auth. This proves the server half:
 * that the store round-trips a session, that the row is sealed rather
 * than plaintext, that revocation is immediate, and that the table
 * cannot be read by the API roles.
 *
 * The last of those is the one that matters most and is easiest to get
 * wrong: a session store an authenticated caller can SELECT is a
 * complete impersonation of every signed-in user, and RLS alone does
 * not stop a blanket grant from handing it over -- which is exactly how
 * the calculation-write boundary was silently reopened earlier in P14.
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

async function isLocalSupabaseReachable(): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${LOCAL_API_URL}/auth/v1/health`,
        { signal: AbortSignal.timeout(1500) },
      );

    return response.ok;
  } catch {
    return false;
  }
}

const ready =
  await isLocalSupabaseReachable();

describe.skipIf(!ready)(
  "the server-side session store (local Supabase only)",
  () => {
    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    const createdUserIds: string[] = [];

    const createdTokens: string[] = [];

    let store: typeof import("../../src/infrastructure/auth/app-session-store");

    beforeAll(async () => {
      process.env.SUPABASE_URL =
        LOCAL_API_URL;

      process.env.SUPABASE_SERVICE_ROLE_KEY =
        LOCAL_SERVICE_ROLE_KEY;

      // A real secret, generated here, so this suite proves sealing
      // rather than depending on the developer's own environment.
      process.env.APP_SESSION_SECRET =
        "p14-app-session-store-test-secret-value-0123456789";

      store =
        await import(
          "../../src/infrastructure/auth/app-session-store"
        );
    });

    afterAll(async () => {
      for (const id of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(id);
      }
    });

    async function makeUser(): Promise<string> {
      const {
        data,
        error,
      } = await serviceClient.auth.admin.createUser(
        {
          email: `p14.store.${crypto.randomUUID().slice(0, 8)}@snowkaptest.dev`,
          password: "StorePassw0rd",
          email_confirm: true,
        },
      );

      if (error || !data.user) {
        throw error ?? new Error("no user");
      }

      createdUserIds.push(data.user.id);

      return data.user.id;
    }

    function providerCookies(
      userId: string,
    ): { name: string; value: string }[] {
      // The shape @supabase/ssr actually writes.
      const session =
        {
          access_token: "not.a.real.token",
          refresh_token: "not-a-real-refresh-token",
          user: { id: userId },
        };

      return [
        {
          name: "sb-127-auth-token",
          value:
            `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
        },
      ];
    }

    it(
      "round-trips a session and mints an unguessable opaque token",
      async () => {
        const userId =
          await makeUser();

        const token =
          await store.persistAppSession(
            {
              token: null,
              cookies: providerCookies(userId),
            },
          );

        createdTokens.push(token);

        expect(token).toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );

        expect(
          await store.loadAppSession(token),
        ).toEqual(
          providerCookies(userId),
        );

        // Writing again with the same token keeps the same token,
        // rather than minting a new session on every refresh.
        expect(
          await store.persistAppSession(
            {
              token,
              cookies: providerCookies(userId),
            },
          ),
        ).toBe(
          token,
        );
      },
    );

    it(
      "stores the session SEALED, and stores no copy of the cookie",
      async () => {
        const userId =
          await makeUser();

        const token =
          await store.persistAppSession(
            {
              token: null,
              cookies: providerCookies(userId),
            },
          );

        const { data } =
          await serviceClient
            .from("app_sessions")
            .select("token_hash, sealed_provider_session")
            .eq("user_id", userId)
            .single();

        const sealed =
          data?.sealed_provider_session as string;

        // Not the plaintext, in any encoding a careless implementation
        // might have reached for.
        expect(sealed).not.toContain("access_token");
        expect(sealed).not.toContain("refresh_token");
        expect(sealed).not.toContain(userId);
        expect(sealed.startsWith("v1.")).toBe(true);

        // And the cookie itself is nowhere in the row -- only its hash,
        // so a read of this table yields nothing replayable.
        expect(data?.token_hash).not.toBe(token);
        expect(JSON.stringify(data)).not.toContain(token);
      },
    );

    it(
      "refuses to store a session whose owner cannot be determined, rather than creating one nobody can revoke",
      async () => {
        await expect(
          store.persistAppSession(
            {
              token: null,
              cookies: [
                { name: "sb-127-auth-token", value: "base64-e30=" },
              ],
            },
          ),
        ).rejects.toThrow(
          /could not determine the owner/i,
        );
      },
    );

    it(
      "revocation takes effect immediately, and a revoked token never loads again",
      async () => {
        const userId =
          await makeUser();

        const token =
          await store.persistAppSession(
            {
              token: null,
              cookies: providerCookies(userId),
            },
          );

        expect(
          await store.loadAppSession(token),
        ).not.toBeNull();

        await store.revokeAppSession(token);

        expect(
          await store.loadAppSession(token),
        ).toBeNull();

        // And it cannot be resurrected by writing to it: a revoked row
        // is not updated, a new session is minted instead.
        expect(
          await store.persistAppSession(
            {
              token,
              cookies: providerCookies(userId),
            },
          ),
        ).not.toBe(
          token,
        );
      },
    );

    it(
      "ends every OTHER session for a user while sparing the one in hand",
      async () => {
        const userId =
          await makeUser();

        const standing =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userId) },
          );

        const otherDevice =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userId) },
          );

        const thirdDevice =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userId) },
          );

        expect(
          await store.revokeOtherAppSessions(
            { userId, keepToken: standing },
          ),
        ).toBe(2);

        expect(
          await store.loadAppSession(standing),
        ).not.toBeNull();

        expect(
          await store.loadAppSession(otherDevice),
        ).toBeNull();

        expect(
          await store.loadAppSession(thirdDevice),
        ).toBeNull();
      },
    );

    it(
      "2026-09-07 (S5 review round 10, finding S10-A-1): revokeOtherAppSessions THROWS on a genuine database error, distinct from a real '0 other sessions' result -- a malformed userId is used only to force a deterministic, reproducible Postgres-level error through this exact code path (in production userId is always a well-formed uuid from a real authenticated session)",
      async () => {
        await expect(
          store.revokeOtherAppSessions(
            { userId: "not-a-real-uuid-at-all", keepToken: null },
          ),
        ).rejects.toThrow(
          /could not revoke other sessions/i,
        );
      },
    );

    it(
      "treats an expired session as no session",
      async () => {
        const userId =
          await makeUser();

        const token =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userId) },
          );

        await serviceClient
          .from("app_sessions")
          .update(
            {
              expires_at:
                new Date(Date.now() - 60_000).toISOString(),
            },
          )
          .eq("user_id", userId);

        expect(
          await store.loadAppSession(token),
        ).toBeNull();
      },
    );

    it(
      "a session sealed under a different secret does not open -- rotation signs people out, it does not leak",
      async () => {
        const userId =
          await makeUser();

        const token =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userId) },
          );

        const original =
          process.env.APP_SESSION_SECRET;

        process.env.APP_SESSION_SECRET =
          "a-completely-different-secret-value-0123456789abc";

        try {
          expect(
            await store.loadAppSession(token),
          ).toBeNull();
        } finally {
          process.env.APP_SESSION_SECRET = original;
        }

        expect(
          await store.loadAppSession(token),
        ).not.toBeNull();
      },
    );

    // --- session fixation (P14, 2026-09-04) ---

    it(
      "NEVER rebinds a supplied identifier to a different user -- the fixation attack",
      async () => {
        // The exact defect: an attacker's own identifier, planted in a
        // signed-out victim's browser, was adopted by the victim's
        // sign-in and rebound to them, so the attacker's copy became
        // the victim's session.
        const attackerId =
          await makeUser();

        const victimId =
          await makeUser();

        const plantedToken =
          await store.persistAppSession(
            {
              token: null,
              cookies: providerCookies(attackerId),
            },
          );

        // The victim authenticates while the browser presents the
        // attacker's identifier.
        const victimToken =
          await store.persistAppSession(
            {
              token: plantedToken,
              cookies: providerCookies(victimId),
            },
          );

        // A fresh identifier, not the planted one.
        expect(victimToken).not.toBe(plantedToken);

        expect(victimToken).toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );

        // The planted identifier is retired, not merely left alone: a
        // copy taken a moment earlier must not outlive the
        // authentication that replaced it.
        expect(
          await store.loadAppSession(plantedToken),
        ).toBeNull();

        // And it never became the victim's.
        const { data: plantedRow } =
          await serviceClient
            .from("app_sessions")
            .select("user_id, revoked_at")
            .eq("user_id", attackerId);

        expect(plantedRow?.length).toBe(1);
        expect(plantedRow?.[0]?.user_id).toBe(attackerId);
        expect(plantedRow?.[0]?.revoked_at).not.toBeNull();

        // The victim's own identifier works, and belongs to them.
        expect(
          await store.loadAppSession(victimToken),
        ).toEqual(
          providerCookies(victimId),
        );

        const { data: victimRows } =
          await serviceClient
            .from("app_sessions")
            .select("user_id, revoked_at")
            .eq("user_id", victimId)
            .is("revoked_at", null);

        expect(victimRows?.length).toBe(1);
      },
    );

    it(
      "rotates on an identity SWITCH too -- the same rule covers the legitimate case",
      async () => {
        // A browser signed in as A opens an invitation or recovery link
        // for B. Not an attack, and handled by the same rule: A is
        // retired, B gets a fresh identifier, nothing is reassigned.
        const userA =
          await makeUser();

        const userB =
          await makeUser();

        const tokenA =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userA) },
          );

        const tokenB =
          await store.persistAppSession(
            { token: tokenA, cookies: providerCookies(userB) },
          );

        expect(tokenB).not.toBe(tokenA);

        expect(
          await store.loadAppSession(tokenA),
        ).toBeNull();

        expect(
          await store.loadAppSession(tokenB),
        ).toEqual(
          providerCookies(userB),
        );
      },
    );

    it(
      "does NOT rotate an ordinary refresh of the same identity -- that would end a live session on every token refresh",
      async () => {
        const userId =
          await makeUser();

        const token =
          await store.persistAppSession(
            { token: null, cookies: providerCookies(userId) },
          );

        expect(
          await store.persistAppSession(
            { token, cookies: providerCookies(userId) },
          ),
        ).toBe(
          token,
        );

        expect(
          await store.loadAppSession(token),
        ).not.toBeNull();
      },
    );

    it(
      "makes ownership immutable at the DATABASE, not only in the application",
      async () => {
        // The application fix is the real one. This is what stops a
        // later refactor, an upsert, or a second writer from quietly
        // reopening the takeover -- and it binds the service role,
        // which is the only role that can reach this table at all.
        const userId =
          await makeUser();

        const otherId =
          await makeUser();

        await store.persistAppSession(
          { token: null, cookies: providerCookies(userId) },
        );

        const { error: reassign } =
          await serviceClient
            .from("app_sessions")
            .update({ user_id: otherId })
            .eq("user_id", userId);

        expect(reassign).not.toBeNull();

        expect(reassign?.message ?? "").toMatch(
          /belongs to the identity it was created for/i,
        );

        // Still owned by whom it was created for.
        const { data: rows } =
          await serviceClient
            .from("app_sessions")
            .select("user_id")
            .eq("user_id", userId);

        expect(rows?.length).toBe(1);

        // The same rule covers moving a live session onto a different
        // cookie, which is the same reassignment wearing the other hat.
        const { error: rehash } =
          await serviceClient
            .from("app_sessions")
            .update({ token_hash: "a-different-identifier" })
            .eq("user_id", userId);

        expect(rehash).not.toBeNull();
      },
    );

    it(
      "is unreachable by the API roles -- the control a blanket grant would silently undo",
      async () => {
        const userId =
          await makeUser();

        await store.persistAppSession(
          { token: null, cookies: providerCookies(userId) },
        );

        const anonClient =
          createClient(
            LOCAL_API_URL,
            LOCAL_ANON_KEY,
            { auth: { persistSession: false } },
          );

        const { data: anonRead, error: anonError } =
          await anonClient
            .from("app_sessions")
            .select("id, token_hash, sealed_provider_session");

        expect(anonRead ?? []).toEqual([]);
        expect(anonError).not.toBeNull();

        const authed =
          createClient(
            LOCAL_API_URL,
            LOCAL_ANON_KEY,
            { auth: { persistSession: false } },
          );

        await authed.auth.signInWithPassword(
          {
            email:
              (
                await serviceClient.auth.admin.getUserById(userId)
              ).data.user?.email ?? "",
            password: "StorePassw0rd",
          },
        );

        const { data: memberRead, error: memberError } =
          await authed
            .from("app_sessions")
            .select("id, token_hash, sealed_provider_session");

        expect(memberRead ?? []).toEqual([]);
        expect(memberError).not.toBeNull();

        // And cannot write one either -- forging a row would be forging
        // a session for any user id chosen.
        const { error: insertError } =
          await authed
            .from("app_sessions")
            .insert(
              {
                token_hash: "forged",
                user_id: userId,
                sealed_provider_session: "v1.forged",
                expires_at:
                  new Date(Date.now() + 60_000).toISOString(),
              },
            );

        expect(insertError).not.toBeNull();
      },
    );
  },
);
