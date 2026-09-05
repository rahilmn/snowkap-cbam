"use server";

import { revalidatePath } from "next/cache";

import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../components/shell/get-preferred-org-id";

import {
  dismissGuidanceItem,
} from "../src/application/guidance/dismiss-guidance-item";

/**
 * SME Experience v2.1.1, S2. Dismissal is a low-risk, idempotent,
 * per-user write bounded by the number of real guidance items that
 * exist for this org (never unboundedly user-suppliable), so this is
 * deliberately NOT rate-limited -- unlike sign-up, invites, or
 * onboarding (P11 §28's own named "auth, mutation, import, sharing"
 * endpoints), which mint new resources or send real email.
 */
export async function dismissGuidanceItemAction(
  formData: FormData,
): Promise<void> {
  const itemKey =
    formData.get(
      "itemKey",
    );

  if (typeof itemKey !== "string" || itemKey.length === 0) {
    return;
  }

  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    redirect(
      "/sign-in",
    );
  }

  await dismissGuidanceItem(
    supabase,
    orgSummary.context,
    itemKey,
  );

  revalidatePath(
    "/",
  );
}
