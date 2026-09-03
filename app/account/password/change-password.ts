import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  verifyCurrentPassword,
} from "../../../src/infrastructure/supabase/password-verification-client";

/**
 * The password-change decision, separated from the Server Action that
 * wraps it.
 *
 * 2026-09-04 (P14, AUTH-1). Two reasons, both deliberate:
 *
 *   1. A "use server" file turns EVERY exported async function into a
 *      POST-reachable endpoint. A helper that accepts a Supabase client
 *      must therefore not live in actions.ts -- exporting it there
 *      would publish a second, unrate-limited door into the same
 *      operation, which is the opposite of the single coherent boundary
 *      this change exists to create.
 *
 *   2. It lets the live regression suite
 *      (tests/integration/password-change-current-password-proof.test.ts)
 *      drive THIS code against a real GoTrue with a real stolen
 *      session, rather than re-implementing the sequence in the test
 *      and proving only that the re-implementation is safe.
 *
 * Everything about authority is here. The action above adds rate
 * limiting, input validation, and message/redirect mapping -- none of
 * which is a security boundary on its own.
 */
export type ChangePasswordOutcome =
  | {
      status: "CHANGED";
      /**
       * False when the password DID change but evicting other sessions
       * failed. Never a failure: see the action's own comment.
       */
      otherSessionsSignedOut: boolean;
    }
  | { status: "NOT_SIGNED_IN" }
  | { status: "CURRENT_PASSWORD_INCORRECT" }
  | { status: "VERIFICATION_UNAVAILABLE" }
  | { status: "WEAK_PASSWORD" }
  | { status: "REAUTHENTICATION_NEEDED" }
  | { status: "SAME_PASSWORD" }
  | { status: "FAILED" };

export async function changePasswordForSession(
  supabase: SupabaseClient,
  {
    currentPassword,
    newPassword,
  }: {
    currentPassword: string;
    newPassword: string;
  },
): Promise<ChangePasswordOutcome> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { status: "NOT_SIGNED_IN" };
  }

  // The proof. Nothing above this line is authority: not the access
  // token, not the refresh token, not how recently the session was
  // created, and not getUser() having succeeded.
  const verification =
    await verifyCurrentPassword(
      {
        email: user.email,
        password: currentPassword,
        expectedUserId: user.id,
      },
    );

  if (verification === "UNAVAILABLE") {
    return { status: "VERIFICATION_UNAVAILABLE" };
  }

  if (verification !== "VERIFIED") {
    return { status: "CURRENT_PASSWORD_INCORRECT" };
  }

  const { error } =
    await supabase.auth.updateUser(
      {
        password: newPassword,
      },
    );

  if (error) {
    if (error.code === "reauthentication_needed") {
      return { status: "REAUTHENTICATION_NEEDED" };
    }

    if (error.code === "weak_password") {
      return { status: "WEAK_PASSWORD" };
    }

    if (error.code === "same_password") {
      return { status: "SAME_PASSWORD" };
    }

    return { status: "FAILED" };
  }

  // The password has now CHANGED. Everything below reports, never
  // retracts.
  //
  // Ending other sessions is what evicts an attacker who was holding a
  // stolen cookie, and it happens only on the far side of a proven
  // current password. `others` is the only scope that does it without
  // ending the session the user is standing in.
  const { error: othersError } =
    await supabase.auth.signOut(
      { scope: "others" },
    );

  return {
    status: "CHANGED",
    otherSessionsSignedOut: !othersError,
  };
}
