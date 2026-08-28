"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import type {
  AuthActionState,
} from "./action-state";

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

  const { data, error } =
    await supabase.auth.signUp(
      parsed.data,
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

export async function signOutAction(): Promise<void> {
  const supabase =
    await getServerSupabaseClient();

  await supabase.auth.signOut();

  redirect("/sign-in");
}
