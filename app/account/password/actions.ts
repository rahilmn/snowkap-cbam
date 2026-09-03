"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import {
  cookies,
} from "next/headers";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  changePasswordForSession,
} from "./change-password";

import {
  APP_SESSION_COOKIE,
} from "../../../src/infrastructure/auth/opaque-session-cookies";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import type {
  AuthActionState,
} from "../../(auth)/action-state";

/**
 * Tighter than the ordinary mutation limits, and deliberately so: with
 * the current-password requirement this endpoint became a place where a
 * credential can be guessed. Matched to SIGN_IN's own bucket rather
 * than to a mutation's, because that is what this now is -- and the
 * attacker being bounded here already holds a session, so there is no
 * legitimate reason to try many times.
 */
const CHANGE_PASSWORD_RATE_LIMIT: RateLimitConfig =
  {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  };

const changePasswordLimiter =
  createInMemoryRateLimiter(
    CHANGE_PASSWORD_RATE_LIMIT,
  );

const MINIMUM_PASSWORD_LENGTH = 8;

/**
 * FormData.get() returns null for a field the caller simply omitted,
 * and a File for a multipart part that is not text. Both are read as
 * "absent" so the schema's own message is what the user sees -- an
 * omitted currentPassword must say "Enter your current password", not
 * leak a validator's type error. Refused either way; this is about
 * telling the truth clearly, and about a direct caller who omits the
 * field getting the same treatment as the form.
 */
function textField(
  formData: FormData,
  name: string,
): string {
  const value =
    formData.get(name);

  return typeof value === "string"
    ? value
    : "";
}

/**
 * `currentPassword` is required and is only ever checked by asking
 * Supabase (see password-verification-client.ts). Note the deliberate
 * absence of any length/complexity rule on it: the current password is
 * whatever it already is, and validating its SHAPE here would leak the
 * policy that produced it and would reject accounts whose password
 * predates a policy change. min(1) exists so that an omitted or empty
 * field is refused before any network call, not as a policy.
 */
const changePasswordSchema =
  z.object(
    {
      currentPassword:
        z.string().min(
          1,
          "Enter your current password.",
        ),

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
  ).refine(
    (value) => value.password !== value.currentPassword,
    {
      message: "The new password must be different from the current one.",
      path: ["password"],
    },
  );

/**
 * Changes the password of the currently signed-in user, requiring proof
 * of the current one.
 *
 * 2026-09-04 (P14, AUTH-1). This action exists because holding a
 * session was, until now, the ONLY thing the product required in order
 * to set a new password -- and a session is precisely what an attacker
 * steals. The confirmed attack: a fresh stolen cookie, no knowledge of
 * the current password, /reset-password rewrites it, the legitimate
 * owner's password stops working, and `scope: "others"` evicts them.
 *
 * The hosted `secure_password_change` setting is kept on as defence in
 * depth, but it is not this boundary and cannot be: measured against a
 * real GoTrue v2.195.0, it refuses an AGED session and admits a FRESH
 * one, and a cookie lifted from a live browser is fresh by definition.
 *
 * So the boundary is here, and it is the credential itself. None of
 * these count as proof, and the code below treats none of them as such:
 * an existing access token, an existing refresh token, a recently
 * created session, getUser() succeeding, or the hosted setting being
 * enabled. Only a current password that Supabase itself accepts does.
 *
 * The recovery flow is a different thing and stays separate:
 * /reset-password is for people who CANNOT supply a current password,
 * and it is gated on having arrived through an emailed link -- see
 * app/auth/session-assurance.ts.
 */
export async function changePasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const rateLimitResult =
    changePasswordLimiter.check(
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
    changePasswordSchema.safeParse(
      {
        currentPassword: textField(formData, "currentPassword"),
        password: textField(formData, "password"),
        confirmPassword: textField(formData, "confirmPassword"),
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

  const outcome =
    await changePasswordForSession(
      supabase,
      {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.password,

        // So that "sign out every other session" spares this one.
        currentAppSessionToken:
          (await cookies()).get(
            APP_SESSION_COOKIE,
          )?.value ?? null,
      },
    );

  switch (outcome.status) {
    case "NOT_SIGNED_IN":
      return {
        status: "error",
        message:
          "You are not signed in. Sign in and try again.",
      };

    case "VERIFICATION_UNAVAILABLE":
      return {
        status: "error",
        message:
          "Your current password could not be verified just now. Try again in a moment.",
      };

    case "CURRENT_PASSWORD_INCORRECT":
      return {
        status: "error",
        message: "Your current password is incorrect.",
      };

    // `reauthentication_needed` can still arrive from the hosted
    // `secure_password_change` control, which stays enabled: this action
    // satisfies the PRODUCT's proof requirement, not GoTrue's separate
    // session-recency one, and the two are deliberately not collapsed
    // into each other.
    case "REAUTHENTICATION_NEEDED":
      return {
        status: "error",
        message:
          "For your security, changing a password also needs a recent sign-in. " +
          "Sign out and sign in again, then try once more.",
      };

    case "WEAK_PASSWORD":
      return {
        status: "error",
        message:
          "Password must include a lowercase letter, an uppercase letter, and a number.",
      };

    case "SAME_PASSWORD":
      return {
        status: "error",
        message:
          "The new password must be different from the current one.",
      };

    case "FAILED":
      return {
        status: "error",
        message: "Something went wrong. Please try again.",
      };

    case "CHANGED":
      break;
  }

  // The password has CHANGED, and nothing from here on may report
  // otherwise. Telling a user "that didn't work" when their password is
  // already different would send them round the loop again with a
  // current password that is no longer current, and the second attempt
  // would fail for a reason the first one caused.
  redirect(
    outcome.otherSessionsSignedOut
      ? "/account/password?changed=1"
      : "/account/password?changed=1&others=failed",
  );
}
