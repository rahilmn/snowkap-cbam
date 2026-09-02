"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

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
  isSafeRedirectPath,
} from "../../auth/callback/is-safe-redirect-path";

import type {
  AuthActionState,
} from "../action-state";

/**
 * P13 release-blocker remediation, finding S4 (see
 * app/(auth)/forgot-password/actions.ts's own doc comment for the full
 * context). Bounds repeated update attempts from one IP the same way
 * every other mutation in this codebase is bounded (master plan §28) --
 * there is no credential to guess here (the caller already holds a
 * valid recovery session by the time this runs), but an unbounded loop
 * of Supabase Auth admin API calls from one source is still worth
 * capping on general principle, matching SIGN_UP's own tightness since
 * this is likewise a rare, deliberate action for a legitimate user.
 */
const UPDATE_PASSWORD_RATE_LIMIT: RateLimitConfig =
  {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  };

const updatePasswordLimiter =
  createInMemoryRateLimiter(
    UPDATE_PASSWORD_RATE_LIMIT,
  );

/**
 * Where to land once the password is set.
 *
 * The invitation flow routes through this screen (/auth/confirm sends an
 * `invite` link here, because GoTrue confirms an invited account without
 * the invitee ever choosing a password), so it has to be able to carry
 * the user onward to /accept-invitation afterwards.
 *
 * The value is re-validated here rather than trusted from the page: it
 * arrives as a hidden form field, and a hidden field is client-controlled
 * at POST time no matter what the page rendered. Same allowlist the auth
 * callback uses -- see is-safe-redirect-path.ts for the open-redirect and
 * session-fixation chain it closes.
 */
function resolveDestination(
  requested: string | undefined,
): string {
  return requested && isSafeRedirectPath(requested)
    ? requested
    : "/";
}

function appendFlag(
  destination: string,
  flag: string,
): string {
  return destination.includes("?")
    ? `${destination}&${flag}`
    : `${destination}?${flag}`;
}

const MINIMUM_PASSWORD_LENGTH = 8;

const updatePasswordSchema =
  z.object(
    {
      password:
        z.string().min(
          MINIMUM_PASSWORD_LENGTH,
          `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
        ),

      confirmPassword:
        z.string(),
    },
  ).refine(
    (value) => value.password === value.confirmPassword,
    {
      message: "Passwords do not match.",
      path: ["confirmPassword"],
    },
  );

/**
 * Sets a new password for the CURRENT session -- the recovery session
 * app/auth/callback/page.tsx's establishSessionAction already wrote
 * into the server client's cookies before redirecting here. Requires a
 * real, currently-authenticated session (checked explicitly via
 * getUser(), never assumed from having reached this route): a stale or
 * already-expired recovery link lands here with no valid session at
 * all, and this must fail with an actionable message rather than a
 * confusing updateUser() error.
 */
export async function updatePasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const rateLimitResult =
    updatePasswordLimiter.check(
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
    updatePasswordSchema.safeParse(
      {
        password: formData.get("password"),
        confirmPassword: formData.get("confirmPassword"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Enter a valid password.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: "error",
      message:
        "This link is invalid or has expired. Request a new password reset link.",
    };
  }

  const { error } =
    await supabase.auth.updateUser(
      {
        password: parsed.data.password,
      },
    );

  if (error) {
    // Supabase's own password_requirements policy (supabase/config.toml,
    // "lower_upper_letters_digits" -- master plan §14's "hardened
    // password policy") rejects a merely-long-enough password with a
    // 422 `weak_password` this form's own client-side minLength={8}
    // never catches -- surfaced specifically rather than folded into
    // the generic fallback below, live-confirmed via a real Supabase
    // Auth response (an all-lowercase-plus-digits 24-character password
    // was rejected) -- the SAME gap sign-up-form.tsx's own minLength={8}
    // has, not introduced here, but worth not repeating in new code.
    if (error.code === "weak_password") {
      return {
        status: "error",
        message:
          "Password must include a lowercase letter, an uppercase letter, and a number.",
      };
    }

    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  // 2026-09-03 (P14). Sign OTHER sessions out, keeping this one.
  //
  // A password change should end every session the old password could
  // have established. `scope: "others"` is the only variant that does
  // that without also ending the session the user is standing in --
  // auth-js skips its own removeCurrentSession for this scope alone.
  //
  // Its outcome must never block the redirect. This action sits on the
  // invitation path (an invited user sets a password here before
  // accepting), and returning an error state after the password has
  // ALREADY changed would strand that user on this form with nothing
  // useful to retry: the password is set, the form cannot tell them so,
  // and the invitation is one screen away. So a failure here is carried
  // to the destination as a notice instead.
  const { error: othersError } =
    await supabase.auth.signOut(
      { scope: "others" },
    );

  const destination =
    resolveDestination(
      formData.get("next")?.toString(),
    );

  redirect(
    othersError
      ? appendFlag(
          destination,
          "password_change=others_not_signed_out",
        )
      : destination,
  );
}
