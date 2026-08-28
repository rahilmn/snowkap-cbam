import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  parseCountryCode,
} from "../../domain/shared/country";

import type {
  Supplier,
} from "../../domain/installations/types";

import type {
  OperatorId,
  OrganizationId,
  SupplierId,
  UserId,
} from "../../domain/shared/ids";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

interface SupplierRow {
  id: string;
  org_id: string;
  name: string;
  country: string | null;
  contact_name: string | null;
  contact_email: string | null;
  linked_operator_id: string | null;
  linked_installation_ids: string[];
  created_at: string;
}

const SUPPLIER_COLUMNS =
  "id, org_id, name, country, contact_name, contact_email, linked_operator_id, linked_installation_ids, created_at";

function toSupplier(
  row: SupplierRow,
): Supplier {
  return {
    id: row.id as Supplier["id"],
    org_id: row.org_id as Supplier["org_id"],
    name: row.name,
    country: row.country as Supplier["country"],
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    linked_operator_id: row.linked_operator_id as OperatorId | null,
    linked_installation_ids: row.linked_installation_ids as Supplier["linked_installation_ids"],
    created_at: row.created_at as Supplier["created_at"],
  };
}

export async function listSuppliers(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Supplier[]> {
  const { data, error } =
    await supabase
      .from("suppliers")
      .select(
        SUPPLIER_COLUMNS,
      )
      .eq("org_id", orgId)
      .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as SupplierRow[]).map(
    toSupplier,
  );
}

export interface SupplierInput {
  name: string;
  country: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

export type ManageSupplierResult =
  | { status: "OK"; supplier: Supplier }
  | { status: "REJECTED"; reason: "INVALID_COUNTRY" | "PERSIST_FAILED" };

export async function createSupplier(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  input: SupplierInput,
): Promise<ManageSupplierResult> {
  const country =
    input.country
      ? parseCountryCode(
          input.country,
        )
      : null;

  if (country && country.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_COUNTRY",
    };
  }

  const { data, error } =
    await supabase
      .from("suppliers")
      .insert(
        {
          org_id: orgId,
          name: input.name,
          country: country?.status === "OK" ? country.value : null,
          contact_name: input.contactName,
          contact_email: input.contactEmail,
        },
      )
      .select(
        SUPPLIER_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const supplier =
    toSupplier(
      data as SupplierRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "supplier.created",
      aggregateType: "SUPPLIER",
      aggregateId: supplier.id,
      payload: {
        name: supplier.name,
      },
    },
  );

  return {
    status: "OK",
    supplier,
  };
}

export type RemoveSupplierResult =
  | { status: "OK" }
  | { status: "REJECTED"; reason: "SUPPLIER_NOT_FOUND" | "PERSIST_FAILED" };

interface SupplierOwnershipRow {
  org_id: string;
}

/**
 * `orgId` is the caller's *active* org (see fetchLineForResolution in
 * resolve-line-emissions.ts for the full reasoning), not necessarily
 * the org that owns `supplierId`. The suppliers_delete_own_org RLS
 * policy alone confines the delete to *an* org the caller belongs to,
 * not specifically this active orgId, so without this check a caller
 * whose active org is A, submitting a supplierId that actually belongs
 * to their other org B, would delete B's supplier while the audit
 * event is recorded under A's org_id -- a cross-aggregate audit
 * misattribution, the same defect found in fetchLineForResolution.
 * Rejecting as SUPPLIER_NOT_FOUND (not a more specific reason) matches
 * how an out-of-scope id is treated there -- it doesn't reveal that the
 * id exists under a different org.
 */
export async function removeSupplier(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  supplierId: SupplierId,
): Promise<RemoveSupplierResult> {
  const { data: existing, error: fetchError } =
    await supabase
      .from("suppliers")
      .select(
        "org_id",
      )
      .eq("id", supplierId)
      .maybeSingle();

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!existing || (existing as SupplierOwnershipRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "SUPPLIER_NOT_FOUND",
    };
  }

  const { error } =
    await supabase
      .from("suppliers")
      .delete()
      .eq("id", supplierId);

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "supplier.removed",
      aggregateType: "SUPPLIER",
      aggregateId: supplierId,
    },
  );

  return {
    status: "OK",
  };
}
