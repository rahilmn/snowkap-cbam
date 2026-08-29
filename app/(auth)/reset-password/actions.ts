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

  // The recovery session updateUser() just confirmed the password
  // against is now an ordinary valid session for this user (Supabase
  // does not invalidate it after a password change) -- land them
  // straight in the app, the same "successful auth action redirects,
  // never returns a state to render" convention signInAction/
  // signUpAction (app/(auth)/actions.ts) already use.
  redirect("/");
}
