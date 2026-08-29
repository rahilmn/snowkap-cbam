import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  CbamDeclarantStatus,
  Organization,
  OrganizationCapability,
} from "../../domain/organizations/types";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import type {
  OrgContext,
} from "./org-context";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  capabilities: OrganizationCapability[];
  eori_number: string | null;
  cbam_declarant_status: CbamDeclarantStatus;
  acts_as_indirect_representative: boolean;
  country_of_establishment: string | null;
  created_at: string;
}

function toOrganization(
  row: OrganizationRow,
): Organization {
  return {
    id: row.id as Organization["id"],
    name: row.name,
    slug: row.slug,
    capabilities: row.capabilities,
    eori_number: row.eori_number,
    cbam_declarant_status: row.cbam_declarant_status,
    acts_as_indirect_representative: row.acts_as_indirect_representative,
    country_of_establishment: row.country_of_establishment as Organization["country_of_establishment"],
    created_at: row.created_at as Organization["created_at"],
  };
}

/**
 * The full organization row (RLS: organizations_select_own_org --
 * any member may read it) for the Org settings screen --
 * deliberately separate from getCurrentOrgSummary, which stays
 * minimal (display name + capabilities only) for authorization/shell
 * rendering, not full-profile editing.
 */
export async function getOrganizationProfile(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Organization | null> {
  const { data, error } =
    await supabase
      .from("organizations")
      .select(
        "id, name, slug, capabilities, eori_number, cbam_declarant_status, acts_as_indirect_representative, country_of_establishment, created_at",
      )
      .eq(
        "id",
        orgId,
      )
      .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toOrganization(
    data,
  );
}

export type UpdateOrganizationResult =
  | { status: "OK" }
  | { status: "PERSIST_FAILED" }
  // Org profile edits (name, EORI, declarant status, and -- notably --
  // capabilities, which every hasCapability() gate elsewhere in this
  // codebase trusts) are OWNER-only, master plan §14/§27 screen 23
  // "danger zone". Before this check moved here, it lived only in the
  // one Server Action caller (app/organization/actions.ts) with no
  // service-layer backstop and no test proving it held -- P13 audit
  // follow-up, matching every other ADMIN+/OWNER-gated service in this
  // codebase (verifyEmissionData, transitionShipmentStatus's LOCK,
  // etc.), which all check role *inside* the service, not only at the
  // caller.
  | { status: "PERMISSION_DENIED" };

export interface OrganizationProfileUpdate {
  name: string;
  eoriNumber: string | null;
  cbamDeclarantStatus: CbamDeclarantStatus;
  countryOfEstablishment: string | null;
  addCapability: OrganizationCapability | null;
}

/**
 * Updates the org's editable profile fields. Capabilities are
 * append-only in the MVP (docs/plans/MASTER_PLAN.md §6): this can add
 * `addCapability` to the existing set but never removes one, so
 * `addCapability` is a single optional capability to union in, not a
 * replacement array the caller could use to drop one.
 */
export async function updateOrganizationProfile(
  supabase: SupabaseClient,
  context: OrgContext,
  update: OrganizationProfileUpdate,
): Promise<UpdateOrganizationResult> {
  if (context.role !== "OWNER") {
    return {
      status: "PERMISSION_DENIED",
    };
  }

  const capabilities =
    update.addCapability && !context.capabilities.includes(update.addCapability)
      ? [...context.capabilities, update.addCapability]
      : context.capabilities;

  const { error } =
    await supabase
      .from("organizations")
      .update(
        {
          name: update.name,
          eori_number: update.eoriNumber,
          cbam_declarant_status: update.cbamDeclarantStatus,
          country_of_establishment: update.countryOfEstablishment,
          capabilities,
        },
      )
      .eq(
        "id",
        context.org_id,
      );

  if (error) {
    return {
      status: "PERSIST_FAILED",
    };
  }

  return {
    status: "OK",
  };
}
