"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

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

import type {
  OnboardingActionState,
} from "./action-state";

/**
 * 2026-08-29 (P13 audit response): master plan §28 names "auth,
 * mutation, import, and sharing endpoints" for rate limiting --
 * createOrganizationAction was unbounded despite each call minting a
 * new, essentially irreversible tenancy root (organizations has no
 * DELETE policy, and organizations_slug_uq is a GLOBAL unique
 * constraint, so a squatted slug can never be reclaimed). IP-keyed,
 * matching every other real-mutation action in this codebase (see
 * app/(auth)/actions.ts's signUpLimiter, app/team/actions.ts's
 * inviteMemberLimiter) -- there is no authenticated identity to key on
 * more precisely at this call site either (same reasoning as those two).
 *
 * 5 attempts per 10 minutes -- deliberately the SAME magnitude as
 * signUpLimiter's own 5-per-10-minutes, not looser: a legitimate user
 * only ever needs a handful of tries (mostly "that slug's taken, try
 * another"), while org creation is at least as hard to reverse as
 * account creation itself, so it does not deserve a looser ceiling.
 */
const CREATE_ORGANIZATION_RATE_LIMIT: RateLimitConfig =
  {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  };

const createOrganizationLimiter =
  createInMemoryRateLimiter(
    CREATE_ORGANIZATION_RATE_LIMIT,
  );

// Mirrors organizations_slug_format_ck in
// supabase/migrations/20260828070000_create_organizations_foundation.sql.
const SLUG_PATTERN =
  /^[a-z0-9]+(-[a-z0-9]+)*$/;

const createOrganizationSchema =
  z.object({
    name:
      z.string().min(1, "Enter your organization's name."),

    slug:
      z.string().regex(
        SLUG_PATTERN,
        "Use lowercase letters, numbers, and hyphens only.",
      ),

    capabilities:
      z
        .array(
          z.enum(["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"]),
        )
        .min(
          1,
          "Choose at least one.",
        ),
  });

export async function createOrganizationAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const createOrganizationRateLimitResult =
    createOrganizationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!createOrganizationRateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(createOrganizationRateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many attempts. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

  const parsed =
    createOrganizationSchema.safeParse(
      {
        name: formData.get("name"),
        slug: formData.get("slug"),
        capabilities: formData.getAll("capabilities"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Check the form and try again.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { error } =
    await supabase.rpc(
      "create_organization_with_owner",
      {
        p_name: parsed.data.name,
        p_slug: parsed.data.slug,
        p_capabilities: parsed.data.capabilities,
      },
    );

  if (error) {
    // 2026-08-29 (P13 audit response): create_organization_with_owner
    // (20260829460000) now rejects an unconfirmed caller with a
    // message containing "confirm" -- the same substring-recognition
    // convention signInAction (app/(auth)/actions.ts) already uses for
    // Supabase Auth's own "email not confirmed" error. This is a real,
    // reachable rejection (not a defensive-only branch), so it gets an
    // honest, specific message rather than falling into the generic
    // catch-all below.
    if (error.message.toLowerCase().includes("confirm")) {
      return {
        status: "error",
        message:
          "Confirm your email address before creating an organization -- check your inbox for the confirmation link.",
      };
    }

    const message =
      error.message.toLowerCase().includes("duplicate") ||
      error.code === "23505"
        ? "That organization URL is already taken -- try a different one."
        : "Something went wrong creating your organization. Please try again.";

    return {
      status: "error",
      message,
    };
  }

  redirect("/");
}
