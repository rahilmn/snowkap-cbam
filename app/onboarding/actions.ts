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

import {
  upsertOrganizationSmeProfile,
} from "../../src/application/organizations/organization-sme-profile";

import type {
  OrgContext,
} from "../../src/application/organizations/org-context";

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
            // 2026-09-03 (P14, F9). .trim() BEFORE .min(1), so a name of
      // nothing but spaces is rejected rather than stored. Production
      // carries "ABC test plant " with a trailing space today, which
      // then appears with it in every picker label, every export and
      // every frozen provenance reference -- a difference no human can
      // see and every string comparison can.
      z.string().trim().min(1, "Enter your organization's name."),

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

  // Membership pre-check (SME plan §7.1). The membership check that
  // already exists is a page-render-time redirect (app/onboarding/
  // page.tsx), which does not protect this Server Action -- a request
  // fired directly at createOrganizationAction, or a second tab that
  // rendered the form before the first tab's submission committed,
  // would reach the RPC regardless. This is the actual duplicate
  // guard: a caller who already holds any active membership does not
  // reach create_organization_with_owner at all. Deliberately not the
  // RPC's own job -- the RPC's contract does not change (v2.1.1 §2's
  // discipline: no protected surface touched without an authorised
  // exception, and this one wasn't authorised).
  const existingMembership =
    await hasActiveMembership(
      supabase,
      user.id,
    );

  if (existingMembership) {
    redirect("/");
  }

  const { data: org, error } =
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

    const isSlugConflict =
      error.message.toLowerCase().includes("duplicate") ||
      error.code === "23505";

    if (isSlugConflict) {
      // A lost response to an EARLIER successful call (the browser
      // never saw the redirect, the user resubmitted) looks
      // identical, from here, to a genuinely-taken slug: both fail
      // this exact RPC call with 23505. Re-checking membership
      // distinguishes them -- if the user now belongs to an org, this
      // was a lost response, and re-declaring "identifier taken" for
      // an org creation that already succeeded (possibly under a
      // colliding slug from an unrelated org) would be actively
      // wrong. /onboarding/setup performs the same idempotent profile
      // upsert this action itself performs below, so nothing is lost
      // by landing there instead of "/".
      const membershipAfterConflict =
        await hasActiveMembership(
          supabase,
          user.id,
        );

      if (membershipAfterConflict) {
        redirect("/onboarding/setup");
      }

      return {
        status: "error",
        message: "That organization URL is already taken -- try a different one.",
      };
    }

    return {
      status: "error",
      message: "Something went wrong creating your organization. Please try again.",
    };
  }

  // Idempotent upsert (org_id is organization_profiles' own primary
  // key) establishing the SME personalisation row for the org this
  // action just created. No sectors are collected on this form yet
  // (the three-section onboarding -- capabilities / sectors / details
  // -- is not yet built; /onboarding/setup is where sectors are
  // actually declared today), so this call's only job right now is to
  // pin updated_by_user_id/updated_at honestly rather than leave the
  // org without a profile row at all. Failure here is NOT fatal to
  // org creation, which already committed -- redirect to "/" exactly
  // as a clean success would, matching the plan's own "on failure,
  // redirect to /" (a future guidance item, not built yet, is where
  // the gap would be surfaced).
  if (org) {
    const ownerContext =
      {
        org_id: org.id,
        user_id: user.id,
        role: "OWNER",
        capabilities: parsed.data.capabilities,
      } as OrgContext;

    await upsertOrganizationSmeProfile(
      supabase,
      ownerContext,
      [],
    );
  }

  redirect("/");
}

/**
 * `app.user_org_ids()` already excludes deactivated memberships
 * (20260829360000) -- reading the same fact this action needs to
 * enforce ("does this user already belong to an org?") directly from
 * `memberships` with the identical `deactivated_at is null` predicate
 * keeps this in exact sync with every RLS policy built on that
 * function, rather than re-deriving a subtly different rule.
 */
async function hasActiveMembership(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  userId: string,
): Promise<boolean> {
  const { data, error } =
    await supabase
      .from("memberships")
      .select(
        "org_id",
      )
      .eq(
        "user_id",
        userId,
      )
      .is(
        "deactivated_at",
        null,
      )
      .limit(
        1,
      );

  // Fails closed toward "an org exists" only in the sense that a read
  // error here means an org creation is refused (redirected to "/")
  // rather than risked -- an unreadable membership table is a Server
  // Action error either way; this errs toward not creating a second
  // organization on it.
  if (error) {
    return true;
  }

  return (data?.length ?? 0) > 0;
}
