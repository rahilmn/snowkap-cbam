import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  parseIsoDate,
  reportingPeriodForReleaseDate,
} from "../../domain/shared/reporting-period";

import type {
  CustomsProcedure,
  Shipment,
} from "../../domain/shipments/types";

import {
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  SHIPMENT_COLUMNS,
  toShipment,
  type ShipmentRow,
} from "./shipment-mapper";

export interface CreateShipmentInput {
  reference: string;
  releaseDate: string;
  customsMrn?: string | null;
  customsProcedure?: CustomsProcedure | null;
}

export type CreateShipmentResult =
  | { status: "OK"; shipment: Shipment }
  | {
      status: "REJECTED";
      reason:
        | "INVALID_DATE"
        | "DUPLICATE_REFERENCE"
        | "PERSIST_FAILED"
        // The caller's org doesn't hold IMPORTER_DECLARANT -- shipments
        // are an importer-only workflow (master plan §6/§14). Checked
        // BEFORE any database read, same posture as every hasAdminAccess
        // gate elsewhere in this codebase (P10/P11 capability-matrix
        // hardening pass -- see docs/architecture/AUTHORIZATION_MATRIX.md's
        // "Capability enforcement" section).
        | "CAPABILITY_NOT_HELD";
    };

/**
 * Creates a DRAFT shipment. release_date -> reporting_period derivation
 * uses src/domain/shared/reporting-period.ts's
 * reportingPeriodForReleaseDate (pure, already tested) and is stored,
 * not recomputed on every read -- see the migration's own header
 * comment for why.
 */
export async function createShipment(
  supabase: SupabaseClient,
  context: OrgContext,
  input: CreateShipmentInput,
): Promise<CreateShipmentResult> {
  if (!hasCapability(context, "IMPORTER_DECLARANT")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const releaseDateResult =
    parseIsoDate(
      input.releaseDate,
    );

  if (releaseDateResult.status === "INVALID") {
    return {
      status: "REJECTED",
      reason: "INVALID_DATE",
    };
  }

  const reportingPeriod =
    reportingPeriodForReleaseDate(
      releaseDateResult.value,
    );

  const { data, error } =
    await supabase
      .from("shipments")
      .insert(
        {
          org_id: orgId,
          reference: input.reference,
          release_date: releaseDateResult.value,
          reporting_period_kind: reportingPeriod.kind,
          reporting_period_year: reportingPeriod.year,
          reporting_period_quarter:
            reportingPeriod.kind === "QUARTERLY"
              ? reportingPeriod.quarter
              : null,
          customs_mrn: input.customsMrn ?? null,
          customs_procedure: input.customsProcedure ?? null,
        },
      )
      .select(
        SHIPMENT_COLUMNS,
      )
      .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return {
        status: "REJECTED",
        reason: "DUPLICATE_REFERENCE",
      };
    }

    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const shipment =
    toShipment(
      data as ShipmentRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "shipment.created",
      aggregateType: "SHIPMENT",
      aggregateId: shipment.id,
      payload: {
        reference: shipment.reference,
        release_date: shipment.release_date,
      },
    },
  );

  return {
    status: "OK",
    shipment,
  };
}
