"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  updateOrganizationProfile,
} from "../../src/application/organizations/organization-profile";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../components/shell/get-client-ip";

import type {
  OrganizationSettingsActionState,
} from "./action-state";

/**
 * OWNER-only, org-wide settings changes (name, EORI, CBAM declarant
 * status, capabilities) -- infrequent by nature (an org has one
 * profile, edited occasionally, not a per-record create a user repeats
 * many times per session). Matches inviteMemberAction's own 20/10min
 * (app/team/actions.ts) for the same "sensitive, rarely-legitimately-
 * repeated settings mutation" reasoning.
 */
const UPDATE_ORGANIZATION_RATE_LIMIT: RateLimitConfig =
  {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  };

const updateOrganizationLimiter =
  createInMemoryRateLimiter(
    UPDATE_ORGANIZATION_RATE_LIMIT,
  );

const updateOrganizationSchema =
  z.object({
    name:
            // 2026-09-03 (P14, F9). .trim() BEFORE .min(1), so a name of
      // nothing but spaces is rejected rather than stored. Production
      // carries "ABC test plant " with a trailing space today, which
      // then appears with it in every picker label, every export and
      // every frozen provenance reference -- a difference no human can
      // see and every string comparison can.
      z.string().trim().min(1, "Enter an organization name."),

    eoriNumber:
      z.string().optional(),

    cbamDeclarantStatus:
      z.enum(["NOT_REGISTERED", "APPLICATION_PENDING", "AUTHORISED"]),

    countryOfEstablishment:
      z.string().optional(),

    addCapability:
      z.enum(["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"]).optional(),
  });

export async function updateOrganizationAction(
  _previousState: OrganizationSettingsActionState,
  formData: FormData,
): Promise<OrganizationSettingsActionState> {
  const rateLimitResult =
    updateOrganizationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(rateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many requests. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

  const parsed =
    updateOrganizationSchema.safeParse(
      {
        name: formData.get("name"),
        eoriNumber: formData.get("eoriNumber") ?? undefined,
        cbamDeclarantStatus: formData.get("cbamDeclarantStatus"),
        countryOfEstablishment: formData.get("countryOfEstablishment") ?? undefined,
        addCapability: formData.get("addCapability") ?? undefined,
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

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You are not a member of an organization.",
    };
  }

  // Danger-zone: org profile edits are OWNER-only per the §14 roles
  // matrix, stricter than the ADMIN-or-OWNER access the underlying
  // organizations_update_admin_or_owner RLS policy technically allows
  // (an earlier-phase decision this screen doesn't relitigate -- see
  // that policy's own comment). Checked again inside
  // updateOrganizationProfile itself (P13 audit follow-up) -- this
  // early return is purely a fast, DB-read-free UX path, not the only
  // enforcement point anymore.
  if (orgSummary.context.role !== "OWNER") {
    return {
      status: "error",
      message: "Only the organization's OWNER can change these settings.",
    };
  }

  const countryOfEstablishment =
    parsed.data.countryOfEstablishment?.trim().toUpperCase();

  if (countryOfEstablishment && !/^[A-Z]{2}$/.test(countryOfEstablishment)) {
    return {
      status: "error",
      message: "Country of establishment must be a 2-letter ISO code (e.g. DE, NL).",
    };
  }

  const result =
    await updateOrganizationProfile(
      supabase,
      orgSummary.context,
      {
        name: parsed.data.name,
        eoriNumber: parsed.data.eoriNumber?.trim() || null,
        cbamDeclarantStatus: parsed.data.cbamDeclarantStatus,
        countryOfEstablishment: countryOfEstablishment || null,
        addCapability: parsed.data.addCapability ?? null,
      },
    );

  if (result.status === "PERMISSION_DENIED") {
    return {
      status: "error",
      message: "Only the organization's OWNER can change these settings.",
    };
  }

  if (result.status === "PERSIST_FAILED") {
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    "/organization",
  );

  return {
    status: "idle",
  };
}
