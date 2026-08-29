"use server";

import { z } from "zod";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import {
  getAppOrigin,
} from "../../team/actions";

import type {
  AuthActionState,
} from "../action-state";

/**
 * P13 release-blocker remediation, finding S4: no password-reset flow
 * existed anywhere in this codebase (grep-confirmed) despite the
 * master plan's own screen inventory naming "Sign in / sign up / reset"
 * as one screen (§27) and app/auth/callback/page.tsx's own doc comment
 * already anticipating "invite, magic link, password reset" as the
 * three email-link shapes it would need to handle.
 *
 * Tighter than SIGN_IN (app/(auth)/actions.ts) and matching SIGN_UP's
 * own reasoning exactly: each attempt is a real Supabase Auth email
 * send, so this bounds automated mass-reset-email abuse -- 5 attempts
 * per 10 minutes per IP.
 */
const REQUEST_PASSWORD_RESET_RATE_LIMIT: RateLimitConfig =
  {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  };

const requestPasswordResetLimiter =
  createInMemoryRateLimiter(
    REQUEST_PASSWORD_RESET_RATE_LIMIT,
  );

const requestPasswordResetSchema =
  z.object(
    {
      email: z.string().email("Enter a valid email address."),
    },
  );

/**
 * Always reports "check-email" once the request is well-formed and
 * within the rate limit, regardless of whether the address actually
 * has an account -- the same anti-enumeration posture signInAction's
 * own "Incorrect email or password" comment establishes, and exactly
 * how Supabase's own resetPasswordForEmail is documented to behave (it
 * does not itself distinguish "sent" from "no such account" via its
 * error return).
 */
export async function requestPasswordResetAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const rateLimitResult =
    requestPasswordResetLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(rateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many attempts. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

  const parsed =
    requestPasswordResetSchema.safeParse(
      {
        email: formData.get("email"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Enter a valid email address.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  const origin =
    await getAppOrigin();

  const { error } =
    await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      {
        // Same allowlisted-`next` mechanism app/team/actions.ts's
        // invite email already relies on (?next=/accept-invitation) --
        // app/auth/callback/page.tsx reads this and, once the recovery
        // session is established, sends the browser to /reset-password
        // to set a new one. is-safe-redirect-path.ts's shape check
        // (single leading slash, no scheme) accepts any root-relative
        // path, so no allowlist change was needed for this new value.
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      },
    );

  if (error) {
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  return {
    status: "check-email",
  };
}
