import "server-only";

import {
  createClient,
} from "@supabase/supabase-js";

/**
 * Proves that whoever is asking knows an account's CURRENT password.
 *
 * 2026-09-04 (P14, AUTH-1). Changing a password is a privileged action,
 * and the owner decision governing it is explicit: a valid application
 * session is not sufficient authority to perform it, because a session
 * cookie is exactly the thing an attacker steals. The current password
 * must be supplied and proved immediately before the change.
 *
 * "Proved" here means proved BY SUPABASE, against the same Auth project
 * the session came from -- not by a second password system invented in
 * this codebase, and not by any comparison performed in application
 * code. The only credential check GoTrue offers is signing in, so that
 * is what this does, and the whole reason this file exists is to do it
 * without collateral damage:
 *
 *   - A FRESH client per call, never memoized. Every other Supabase
 *     client in this tree is deliberately cached; this one must not be.
 *     auth-js keeps the signed-in session in the client instance (in
 *     memory even with persistSession:false), so a shared instance
 *     would carry one caller's just-verified session into the next
 *     request that happened to reuse it.
 *
 *   - `persistSession: false`, so it can never write the caller's
 *     session cookies. Verifying a password must not silently re-issue,
 *     replace, or extend the session the user is standing in --
 *     measured against a real GoTrue: the verification sign-in produces
 *     a SEPARATE session id, and the caller's own session is untouched.
 *
 *   - The verification session is revoked before this function returns.
 *     signInWithPassword really does mint a session server-side, and
 *     leaving it alive would mean every password change quietly littered
 *     a live refresh token. `scope: "local"` revokes exactly that one
 *     session -- confirmed live: afterwards the verification refresh
 *     token is rejected ("Refresh Token Not Found") while the caller's
 *     own session still validates.
 *
 * The anon key, not the service role: this must go through the ordinary
 * credential path with ordinary privileges. A service-role client has
 * no business anywhere near a password prompt.
 *
 * The password itself never leaves this function. It is not returned,
 * not stored, not logged, and not attached to any error -- the result
 * is a three-value verdict and nothing more.
 */
export type CurrentPasswordVerification =
  | "VERIFIED"
  | "INCORRECT"
  | "UNAVAILABLE";

export async function verifyCurrentPassword(
  {
    email,
    password,
    expectedUserId,
  }: {
    email: string;
    password: string;
    expectedUserId: string;
  },
): Promise<CurrentPasswordVerification> {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured.",
    );
  }

  const verificationClient =
    createClient(
      url,
      anonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

  const {
    data,
    error,
  } = await verificationClient.auth.signInWithPassword(
    {
      email,
      password,
    },
  );

  if (error || !data.session) {
    // Every failure reads the same to the caller. A wrong password and
    // a rate-limited or unreachable Auth service are distinguished only
    // so the UI can say something true about which happened -- never so
    // that the response reveals anything about the credential.
    //
    // invalid_credentials is what this GoTrue returns for a wrong
    // password (measured: code invalid_credentials, status 400).
    return error &&
      error.code !== "invalid_credentials"
      ? "UNAVAILABLE"
      : "INCORRECT";
  }

  // Revoke the session this verification just created. Ordered before
  // the identity check below so it happens on every path that got a
  // session at all, including the one that is about to be refused.
  await verificationClient.auth.signOut(
    {
      scope: "local",
    },
  ).catch(
    () => undefined,
  );

  // Defence in depth. The caller passes the email it read from its own
  // verified session, so this should be impossible; if it ever is not,
  // "someone proved a password for a different account" must not count
  // as proof for this one.
  if (data.user?.id !== expectedUserId) {
    return "INCORRECT";
  }

  return "VERIFIED";
}
