"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  upsertOrganizationSmeProfile,
} from "../../../src/application/organizations/organization-sme-profile";

import type {
  OnboardingSetupActionState,
} from "./action-state";

// Mirrors organization_profiles' own CHECK constraint
// (20260905150000) -- ELECTRICITY is a real member of the canonical
// sector enum but is refused here for v1, matching the SME plan's own
// wording: no default emission values are loaded for electricity yet,
// so accepting it would let an org declare a sector the rest of the
// product can never act on.
const setupSchema =
  z.object({
    sectors:
      z.array(
        z.enum(["CEMENT", "FERTILISERS", "IRON_STEEL", "ALUMINIUM", "HYDROGEN"]),
      ),
  });

/**
 * The retry/finish path for onboarding-setup (SME plan §7.1): reached
 * either from a lost-response reconciliation redirect
 * (app/onboarding/actions.ts) or as an ordinary "finish setup" /
 * "update sectors" action later. Idempotent for the same reason
 * upsertOrganizationSmeProfile itself is -- calling this twice with
 * the same sectors is a no-op beyond updated_at/updated_by_user_id.
 */
export async function updateOnboardingSetupAction(
  _previousState: OnboardingSetupActionState,
  formData: FormData,
): Promise<OnboardingSetupActionState> {
  const parsed =
    setupSchema.safeParse(
      {
        sectors: formData.getAll("sectors"),
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
    redirect("/onboarding");
  }

  const result =
    await upsertOrganizationSmeProfile(
      supabase,
      orgSummary.context,
      parsed.data.sectors,
    );

  if (result.status === "PERMISSION_DENIED") {
    return {
      status: "error",
      message: "Only an admin or owner can finish setup for this organization.",
    };
  }

  if (result.status === "PERSIST_FAILED") {
    return {
      status: "error",
      message: "Something went wrong saving your sectors. Please try again.",
    };
  }

  revalidatePath(
    "/onboarding/setup",
  );

  revalidatePath(
    "/",
  );

  return {
    status: "success",
    message: "Saved.",
  };
}
