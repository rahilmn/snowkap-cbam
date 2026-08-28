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

import type {
  OrganizationSettingsActionState,
} from "./action-state";

const updateOrganizationSchema =
  z.object({
    name:
      z.string().min(1, "Enter an organization name."),

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
  // that policy's own comment).
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
      orgSummary.context.org_id,
      orgSummary.context.capabilities,
      {
        name: parsed.data.name,
        eoriNumber: parsed.data.eoriNumber?.trim() || null,
        cbamDeclarantStatus: parsed.data.cbamDeclarantStatus,
        countryOfEstablishment: countryOfEstablishment || null,
        addCapability: parsed.data.addCapability ?? null,
      },
    );

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
