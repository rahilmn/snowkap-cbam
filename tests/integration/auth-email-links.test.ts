import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  afterAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  extractAppLink,
  isMailpitReachable,
  waitForEmailTo,
} from "../support/mailpit";

/**
 * The auth email links a real recipient actually receives, and what
 * happens when they are used, used twice, or used from a different
 * browser.
 *
 * WHY THIS SUITE EXISTS. Every previous assertion about auth email in
 * this repository stopped at "a send was requested". The shape of the
 * delivered link was never checked anywhere -- which is how the defect of
 * 2026-09-02 survived: the emailed link pointed at GoTrue's
 * /auth/v1/verify endpoint, which consumes its single-use token on GET,
 * so a corporate mail-security scanner opening the link 76 seconds after
 * delivery burned an invitation token before the invitee ever clicked.
 *
 * It is also the only place, anywhere, that can prove the two GoTrue
 * behaviours the new design depends on and which no amount of reading
 * the installed client library can establish:
 *
 *   - a token_hash verifies a PKCE-initiated recovery link WITHOUT the
 *     browser-bound code_verifier, which is what makes cross-device
 *     password recovery work at all; and
 *   - a second use of the same token_hash fails with otp_expired.
 *
 * Both are asserted here against the real GoTrue in the local stack.
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

const ready =
  (await isLocalSupabaseReachable()) &&
  (await isMailpitReachable());

describe.skipIf(!ready)(
  "auth email links (local Supabase + Mailpit only)",
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
          auth: { persistSession: false },
        },
      );
    }

    afterAll(async () => {
      for (const userId of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "sends an invitation whose link points at the application, not at GoTrue's verify endpoint",
      async () => {
        const email =
          `link-invite-${runId}@example.com`;

        const { data, error } =
          await serviceClient.auth.admin.inviteUserByEmail(
            email,
          );

        expect(error).toBeNull();

        if (data.user) {
          createdUserIds.push(
            data.user.id,
          );
        }

        const delivered =
          await waitForEmailTo(
            email,
          );

        const link =
          extractAppLink(
            delivered,
            "/auth/confirm",
          );

        // The property that fixes the production defect: a token_hash,
        // which /auth/confirm exchanges behind an explicit Continue,
        // rather than a token on an endpoint that spends it on GET.
        expect(
          link.searchParams.get("token_hash"),
        ).toBeTruthy();

        expect(
          link.searchParams.get("type"),
        ).toBe(
          "invite",
        );

        // No next on an invitation: parse-confirm-link.ts routes it to
        // the set-password step, and that decision lives in one place.
        expect(
          link.searchParams.get("next"),
        ).toBeNull();

        expect(delivered.html).not.toContain(
          "/auth/v1/verify",
        );
      },
    );

    it(
      "verifies an invitation token_hash into a real session, and refuses the same token_hash a second time",
      async () => {
        const email =
          `link-invite-twice-${runId}@example.com`;

        const { data, error } =
          await serviceClient.auth.admin.inviteUserByEmail(
            email,
          );

        expect(error).toBeNull();

        if (data.user) {
          createdUserIds.push(
            data.user.id,
          );
        }

        const link =
          extractAppLink(
            await waitForEmailTo(email),
            "/auth/confirm",
          );

        const tokenHash =
          link.searchParams.get("token_hash")!;

        const first =
          await anonClient().auth.verifyOtp(
            { token_hash: tokenHash, type: "invite" },
          );

        expect(first.error).toBeNull();
        expect(first.data.session).not.toBeNull();

        // Single use. This is correct security behaviour and stays --
        // the fix was never to make tokens reusable, it was to stop
        // anything but the recipient spending them.
        const second =
          await anonClient().auth.verifyOtp(
            { token_hash: tokenHash, type: "invite" },
          );

        expect(second.error).not.toBeNull();
        expect(second.error?.code).toBe(
          "otp_expired",
        );
      },
    );

    it(
      "verifies a PKCE-initiated recovery link on a DIFFERENT client with no code_verifier -- the property cross-device password recovery depends on",
      async () => {
        // resetPasswordForEmail from a PKCE-flow client produces a
        // pkce_-prefixed token. If token_hash verification required the
        // matching code_verifier, a reset opened on a phone after being
        // requested on a laptop could never work -- and nothing in the
        // installed client library can establish either way. Hence a real
        // GoTrue.
        const email =
          `link-recovery-${runId}@example.com`;

        const { data: created, error: createError } =
          await serviceClient.auth.admin.createUser(
            {
              email,
              password: `recovery-password-${runId}!`,
              email_confirm: true,
            },
          );

        expect(createError).toBeNull();

        createdUserIds.push(
          created!.user!.id,
        );

        const requestingClient =
          createClient(
            LOCAL_API_URL,
            LOCAL_ANON_KEY,
            {
              auth: {
                persistSession: false,
                flowType: "pkce",
              },
            },
          );

        const { error: resetError } =
          await requestingClient.auth.resetPasswordForEmail(
            email,
          );

        expect(resetError).toBeNull();

        const link =
          extractAppLink(
            await waitForEmailTo(
              email,
              { subjectIncludes: "Reset" },
            ),
            "/auth/confirm",
          );

        expect(
          link.searchParams.get("type"),
        ).toBe(
          "recovery",
        );

        // A different client entirely: no shared storage, no verifier.
        const otherDevice =
          anonClient();

        const verified =
          await otherDevice.auth.verifyOtp(
            {
              token_hash: link.searchParams.get("token_hash")!,
              type: "recovery",
            },
          );

        expect(verified.error).toBeNull();
        expect(verified.data.session).not.toBeNull();
      },
    );

    it(
      "sends a magic link that verifies, for an address that already has an account -- the re-invite path",
      async () => {
        // admin.inviteUserByEmail refuses a confirmed existing user, so
        // without this path a re-invited colleague would receive nothing
        // at all and simply never hear about the invitation.
        const email =
          `link-magic-${runId}@example.com`;

        const { data: created, error: createError } =
          await serviceClient.auth.admin.createUser(
            {
              email,
              password: `magic-password-${runId}!`,
              email_confirm: true,
            },
          );

        expect(createError).toBeNull();

        createdUserIds.push(
          created!.user!.id,
        );

        const { error: inviteError } =
          await serviceClient.auth.admin.inviteUserByEmail(
            email,
          );

        expect(inviteError).not.toBeNull();
        expect(inviteError?.code).toBe(
          "email_exists",
        );

        const { error: otpError } =
          await serviceClient.auth.signInWithOtp(
            {
              email,
              options: {
                shouldCreateUser: false,
              },
            },
          );

        expect(otpError).toBeNull();

        const link =
          extractAppLink(
            await waitForEmailTo(
              email,
              { subjectIncludes: "sign-in link" },
            ),
            "/auth/confirm",
          );

        expect(
          link.searchParams.get("type"),
        ).toBe(
          "magiclink",
        );

        expect(
          link.searchParams.get("next"),
        ).toBe(
          "/accept-invitation",
        );

        const verified =
          await anonClient().auth.verifyOtp(
            {
              token_hash: link.searchParams.get("token_hash")!,
              type: "magiclink",
            },
          );

        expect(verified.error).toBeNull();
        expect(verified.data.session).not.toBeNull();
      },
    );

    it(
      "refuses to create an account through the magic-link path",
      async () => {
        const { error } =
          await serviceClient.auth.signInWithOtp(
            {
              email: `link-unknown-${runId}@example.com`,
              options: {
                shouldCreateUser: false,
              },
            },
          );

        expect(error).not.toBeNull();
      },
    );
  },
);
