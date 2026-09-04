import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  CbamSector,
  OrganizationSmeProfile,
} from "../../domain/organizations/types";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import type {
  OrgContext,
} from "./org-context";

interface OrganizationProfileRow {
  org_id: string;
  sectors: CbamSector[];
  onboarding_completed_at: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
}

function toOrganizationSmeProfile(
  row: OrganizationProfileRow,
): OrganizationSmeProfile {
  return {
    org_id: row.org_id as OrganizationSmeProfile["org_id"],
    sectors: row.sectors,
    onboarding_completed_at: row.onboarding_completed_at as OrganizationSmeProfile["onboarding_completed_at"],
    updated_at: row.updated_at as OrganizationSmeProfile["updated_at"],
    updated_by_user_id: row.updated_by_user_id as OrganizationSmeProfile["updated_by_user_id"],
  };
}

/**
 * The SME personalisation row for an org (organization_profiles --
 * distinct from getOrganizationProfile's base `organizations` row:
 * name/slug/EORI/declarant-status live there, self-declared sectors
 * and onboarding-setup completion live here). Returns `null` for an
 * org that has never gone through onboarding-setup -- callers treat
 * that as "no sectors declared yet, setup not finished," never as an
 * error.
 */
export async function getOrganizationSmeProfile(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<OrganizationSmeProfile | null> {
  const { data, error } =
    await supabase
      .from("organization_profiles")
      .select(
        "org_id, sectors, onboarding_completed_at, updated_at, updated_by_user_id",
      )
      .eq(
        "org_id",
        orgId,
      )
      .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toOrganizationSmeProfile(
    data,
  );
}

export type UpsertOrganizationSmeProfileResult =
  | { status: "OK"; profile: OrganizationSmeProfile }
  | { status: "PERSIST_FAILED" }
  // Matches organization_profiles_insert_admin_or_owner/
  // _update_admin_or_owner (20260905150000): personalisation is
  // visible to any member but only ADMIN+ may set it -- same posture
  // updateOrganizationProfile already holds for the base org row,
  // checked in-service, not only at the caller.
  | { status: "PERMISSION_DENIED" };

/**
 * Upsert on the org's own row (org_id is the primary key). Idempotent
 * by construction -- calling this twice with the same sectors is a
 * no-op beyond updated_at/updated_by_user_id moving, matching the
 * plan's onboarding-setup retry path (§7.1: "the profile write is an
 * idempotent upsert on the PK"). `updated_at`/`updated_by_user_id` are
 * never accepted from the caller -- the database trigger
 * (app.stamp_organization_profile_actor) pins both, so nothing here
 * needs to set them.
 *
 * `onboarding_completed_at` is set to the current time by this
 * function itself, exactly once: when `sectors` is non-empty AND the
 * existing row (if any) does not already have it set. A caller can
 * never move it backwards to null, and calling this again with a
 * different sector list after setup is already complete does not
 * reset it -- "finished setup" is a one-way fact about the org, not a
 * snapshot of the most recent write (SME plan §7.1).
 */
export async function upsertOrganizationSmeProfile(
  supabase: SupabaseClient,
  context: OrgContext,
  sectors: CbamSector[],
): Promise<UpsertOrganizationSmeProfileResult> {
  if (context.role !== "ADMIN" && context.role !== "OWNER") {
    return {
      status: "PERMISSION_DENIED",
    };
  }

  const existing =
    await getOrganizationSmeProfile(
      supabase,
      context.org_id,
    );

  const onboardingCompletedAt =
    existing?.onboarding_completed_at ??
    (sectors.length > 0 ? new Date().toISOString() : null);

  const { data, error } =
    await supabase
      .from("organization_profiles")
      .upsert(
        {
          org_id: context.org_id,
          sectors,
          onboarding_completed_at: onboardingCompletedAt,
        },
        { onConflict: "org_id" },
      )
      .select(
        "org_id, sectors, onboarding_completed_at, updated_at, updated_by_user_id",
      )
      .maybeSingle();

  if (error || !data) {
    return {
      status: "PERSIST_FAILED",
    };
  }

  return {
    status: "OK",
    profile: toOrganizationSmeProfile(
      data,
    ),
  };
}
