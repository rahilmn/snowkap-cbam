"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import {
  cookies,
} from "next/headers";

import {
  clearAuthCookiesAtScopes,
} from "@supabase/ssr";

/**
 * The cookie name @supabase/ssr derives from the project URL, which is
 * what its own storage adapter uses and therefore what has to be
 * cleared. Derived rather than hardcoded so it cannot drift from the
 * project this deployment actually points at.
 */
function authStorageKey(): string {
  // Parsed with a regex rather than `new URL`, which throws on a
  // missing or malformed value. This runs on the sign-out path: an
  // exception here would turn "we could not confirm your sign-out" into
  // a crash, which is strictly worse. A value that cannot be parsed
  // yields a key that simply matches no cookie, and the redirect still
  // happens.
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const projectRef =
    /^https?:\/\/([^./:]+)/.exec(url)?.[1] ?? "";

  return `sb-${projectRef}-auth-token`;
}

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../components/shell/get-client-ip";

import {
  getAppOrigin,
} from "../team/actions";

import type {
  AuthActionState,
} from "./action-state";

/**
 * "Too many attempts" for a rejected sign-in/sign-up, in the same
 * generic-message spirit as signInAction's own "Incorrect email or
 * password" comment above -- the retry-after seconds are the only
 * caller-specific detail exposed, never which limiter or key rejected
 * the request.
 */
function tooManyAttemptsState(
  retryAfterMs: number,
): AuthActionState {
  const retryAfterSeconds =
    Math.ceil(retryAfterMs / 1000);

  return {
    status: "error",
    message:
      `Too many attempts. Try again in ${retryAfterSeconds} ` +
      `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
  };
}

/**
 * Module-scope singletons -- one process-lifetime InMemoryRateLimiter
 * per action, per rate-limiter.ts's own header comment ("single-
 * process, in-memory... does NOT survive a process restart"). Keyed
 * by caller IP alone (getClientIp(), read before any Supabase call):
 * neither action has an authenticated identity to key on yet, and
 * signInAction's whole point is to never reveal which email exists,
 * so keying on the submitted email would itself leak a signal this
 * action deliberately avoids everywhere else.
 *
 * SIGN_IN: a genuine person mistyping a password twice in a row is
 * common and must not be blocked (see this file's own "Incorrect
 * email or password" comment on treating users kindly around auth
 * errors) -- 10 attempts per 5 minutes comfortably covers a slow
 * typist or a shared office NAT with several people signing in
 * around the same time, while still capping a credential-stuffing
 * script at a low, effectively useless rate (worst case ~1 guess per
 * 30s, sustained).
 */
const SIGN_IN_RATE_LIMIT: RateLimitConfig =
  {
    limit: 10,
    windowMs: 5 * 60 * 1000,
  };

const signInLimiter =
  createInMemoryRateLimiter(
    SIGN_IN_RATE_LIMIT,
  );

/**
 * SIGN_UP: legitimate resubmission is rarer than for sign-in (mostly
 * "fix a validation error and resubmit," a handful of times at
 * most), but each attempt is a real Supabase Auth account-creation
 * call, so this is deliberately tighter than SIGN_IN to bound
 * automated mass-account-creation -- 5 attempts per 10 minutes per
 * IP.
 */
const SIGN_UP_RATE_LIMIT: RateLimitConfig =
  {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  };

const signUpLimiter =
  createInMemoryRateLimiter(
    SIGN_UP_RATE_LIMIT,
  );

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * "Incorrect email or password" for any credential failure -- never
 * distinguishes "no such account" from "wrong password" (a standard
 * anti-enumeration practice: revealing which one it was lets an
 * attacker discover which emails have accounts).
 */
export async function signInAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const signInRateLimitResult =
    signInLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!signInRateLimitResult.allowed) {
    return tooManyAttemptsState(
      signInRateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    signInSchema.safeParse(
      {
        email: formData.get("email"),
        password: formData.get("password"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Enter a valid email and password.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  const { error } =
    await supabase.auth.signInWithPassword(
      parsed.data,
    );

  if (error) {
    if (error.message.toLowerCase().includes("confirm")) {
      return {
        status: "error",
        message:
          "Confirm your email address before signing in -- check your inbox for the confirmation link.",
      };
    }

    return {
      status: "error",
      message: "Incorrect email or password.",
    };
  }

  redirect("/");
}

const MINIMUM_PASSWORD_LENGTH = 8;

const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password:
    z.string().min(
      MINIMUM_PASSWORD_LENGTH,
      `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    ),
});

export async function signUpAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const signUpRateLimitResult =
    signUpLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!signUpRateLimitResult.allowed) {
    return tooManyAttemptsState(
      signUpRateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    signUpSchema.safeParse(
      {
        email: formData.get("email"),
        password: formData.get("password"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Enter a valid email and password.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  // The confirmation link must be built from the origin that actually
  // served this request -- never left to GoTrue's fallback, which is the
  // project's dashboard "Site URL". A hosted project whose Site URL still
  // reads http://localhost:3000 would mail every new user a link to a
  // host that does not exist for them: signup would appear to succeed,
  // the message would say "check your email," and confirmation would be
  // impossible to complete. No test or type in this repository can catch
  // that, because the broken half lives in remote configuration. Sending
  // it explicitly moves the decision to the only party that knows the
  // answer -- the deployment handling the request.
  //
  // `/onboarding` is where a confirmed-and-signed-in new user belongs,
  // matching the immediate-session branch below. The value goes through
  // app/auth/callback/is-safe-redirect-path.ts on the way back, like
  // every other `next` this app issues.
  const origin =
    await getAppOrigin();

  const { data, error } =
    await supabase.auth.signUp(
      {
        ...parsed.data,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
        },
      },
    );

  if (error) {
    if (error.message.toLowerCase().includes("already registered") ||
      error.message.toLowerCase().includes("already exists")) {
      // Deliberately the SAME generic message an unrelated failure
      // would get -- confirming "this email is already registered" to
      // an unauthenticated caller is the same enumeration risk sign-in
      // errors avoid above.
      return {
        status: "error",
        message:
          "Something went wrong creating your account. If you already have one, try signing in instead.",
      };
    }

    return {
      status: "error",
      message: "Something went wrong creating your account. Please try again.",
    };
  }

  // Auth is configured with email confirmations required (or not) per
  // environment (supabase/config.toml locally; the live project's own
  // dashboard setting, not yet pushed there -- see the onboarding RPC
  // migration's commit message). data.session is null exactly when
  // confirmation is still pending, regardless of which is true here.
  if (!data.session) {
    return {
      status: "check-email",
    };
  }

  redirect("/onboarding");
}

/**
 * 2026-09-03 (P14, F1). Signing out must actually sign this browser out,
 * whether or not the auth service agrees.
 *
 * This was `await supabase.auth.signOut()` with the error discarded,
 * followed by an unconditional redirect. Most of the time that is fine:
 * auth-js clears local storage itself on nearly every failure path. The
 * one that matters is the `sessionError` early return -- when the client
 * cannot read the current session at all, it returns before touching
 * storage, so the session cookies survive and the user lands on
 * /sign-in still holding a live session. On a shared machine that is
 * precisely the case where someone believed they had signed out.
 *
 * A second signOut() call does not help: it re-enters the same path
 * through auth-js's own refresh-failure cooldown. The cookies have to be
 * cleared directly, which is what clearAuthCookiesAtScopes does -- every
 * chunk of the storage key, at the same cookie options this app writes
 * them with, so a chunked session is not half-deleted.
 *
 * The redirect is unconditional either way. Stranding someone on an
 * error page while their cookies have already been cleared would be the
 * worst of both: signed out in fact, and told it failed.
 *
 * When the service could not confirm the sign-out, /sign-in is told so
 * it can say what happened. The flag is only ever set here, and the
 * sign-in page only renders the notice when there is genuinely no
 * session left -- otherwise a hand-typed query parameter would be a
 * ready-made phishing line on the real origin.
 */
export async function signOutAction(): Promise<void> {
  const supabase =
    await getServerSupabaseClient();

  const { error } =
    await supabase.auth.signOut();

  if (error) {
    const cookieStore =
      await cookies();

    await clearAuthCookiesAtScopes(
      {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (
            const { name, value, options } of cookiesToSet
          ) {
            cookieStore.set(
              name,
              value,
              options,
            );
          }
        },
        storageKey: authStorageKey(),
        // Cleared at the same options this app writes them with, and
        // at the bare path too: a cookie written with a different
        // `secure`/`sameSite` combination in an earlier deploy would
        // otherwise survive its own deletion.
        scopes: [
          {
            path: "/",
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            httpOnly: true,
          },
          { path: "/" },
        ],
      },
    );

    redirect("/sign-in?signed_out=unconfirmed");
  }

  redirect("/sign-in");
}
