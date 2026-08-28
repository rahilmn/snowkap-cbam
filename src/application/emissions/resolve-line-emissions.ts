import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  resolveDefaultValue,
} from "../../domain/regulatory/resolve-default-value";

import type {
  DefaultValueResolutionResult,
} from "../../domain/regulatory/types";

import {
  buildResolutionSnapshot,
} from "../../domain/emissions/build-resolution-snapshot";

import type {
  CountryMappingOutcome,
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  ShipmentLine,
} from "../../domain/shipments/types";

import type {
  OrganizationId,
  ShipmentLineId,
  UserId,
} from "../../domain/shared/ids";

import type {
  RegulatoryCountryMapper,
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  SHIPMENT_LINE_COLUMNS,
  toShipmentLine,
  type ShipmentLineRow,
} from "../shipments/shipment-mapper";

export type ResolveLineEmissionsRejectionReason =
  | "LINE_NOT_FOUND"
  | "ALREADY_DETERMINED"
  | "SHIPMENT_NOT_EDITABLE"
  | "FETCH_FAILED"
  | "PERSIST_FAILED";

export type ResolveLineEmissionsResult =
  | { status: "DETERMINED"; line: ShipmentLine; resolution: DefaultValueResolutionResult }
  | { status: "UNRESOLVED"; resolution: DefaultValueResolutionResult; countryMapping: CountryMappingOutcome }
  | { status: "REJECTED"; reason: ResolveLineEmissionsRejectionReason };

interface LineForResolution {
  cn_code: string;
  origin_country: string;
  production_route_indicator: string | null;
  emission_determination: EmissionDetermination | null;
}

async function fetchLineForResolution(
  supabase: SupabaseClient,
  lineId: ShipmentLineId,
): Promise<
  | { status: "OK"; line: LineForResolution }
  | { status: "REJECTED"; reason: ResolveLineEmissionsRejectionReason }
> {
  const { data, error } =
    await supabase
      .from("shipment_lines")
      .select(
        "cn_code, origin_country, production_route_indicator, emission_determination",
      )
      .eq("id", lineId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!data) {
    return {
      status: "REJECTED",
      reason: "LINE_NOT_FOUND",
    };
  }

  return {
    status: "OK",
    line: data as LineForResolution,
  };
}

/**
 * The `origin_country_name` handed to the (protected, unmodified)
 * resolver. For an UNLISTED code this is deliberately never a real
 * dataset country name -- a synthetic, self-documenting placeholder
 * that cannot collide with one -- so `resolveDefaultValue`'s own
 * unmodified fallback logic runs (0 records for this "country" ->
 * automatic fallback to the Other Countries and Territories geography,
 * correctly labeled OTHER_COUNTRIES_FALLBACK). See
 * src/domain/emissions/types.ts's CountryMappingOutcome doc comment
 * for why the snapshot separately records MAPPED/UNLISTED rather than
 * relying on the resolver's reason alone.
 */
function resolutionCountryName(
  mapping: CountryMappingOutcome,
  isoCode: string,
): string {
  return mapping.status === "MAPPED"
    ? mapping.regulatory_country_name
    : `(unlisted origin: ${isoCode})`;
}

interface PerformResolutionOptions {
  allowOverwrite: boolean;
  auditEventType: string;
}

async function performResolution(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  mapper: RegulatoryCountryMapper,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
  options: PerformResolutionOptions,
): Promise<ResolveLineEmissionsResult> {
  const fetched =
    await fetchLineForResolution(
      supabase,
      lineId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  const { line } =
    fetched;

  if (line.emission_determination && !options.allowOverwrite) {
    return {
      status: "REJECTED",
      reason: "ALREADY_DETERMINED",
    };
  }

  const countryMapping =
    await mapper.mapCountry(
      line.origin_country,
    );

  const input =
    {
      origin_country_name: resolutionCountryName(
        countryMapping,
        line.origin_country,
      ),
      trade_code: line.cn_code,
      production_route: line.production_route_indicator,
    };

  const candidates =
    await repository.findActiveDefaultEmissionCandidates(
      input,
    );

  const resolution =
    resolveDefaultValue(
      candidates,
      input,
    );

  const snapshot =
    buildResolutionSnapshot(
      resolution,
      countryMapping,
      new Date().toISOString() as IsoTimestamp,
    );

  if (!snapshot) {
    return {
      status: "UNRESOLVED",
      resolution,
      countryMapping,
    };
  }

  const determination: EmissionDetermination =
    {
      method: "DEFAULT",
      resolution: snapshot,
    };

  const { data, error } =
    await supabase
      .from("shipment_lines")
      .update(
        {
          emission_determination: determination,
        },
      )
      .eq("id", lineId)
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: error.code === "42501" ? "SHIPMENT_NOT_EDITABLE" : "PERSIST_FAILED",
    };
  }

  if (!data) {
    // RLS silently excludes the row when the parent shipment is
    // LOCKED/VOID (shipment_lines_update_parent_not_terminal), same
    // idiom as manage-lines.ts's updateLine.
    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_EDITABLE",
    };
  }

  const updatedLine =
    toShipmentLine(
      data as ShipmentLineRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: options.auditEventType,
      aggregateType: "SHIPMENT_LINE",
      aggregateId: updatedLine.id,
      payload: {
        shipment_id: updatedLine.shipment_id,
        line_number: updatedLine.line_number,
        reason: resolution.reason,
        dataset_version: snapshot.dataset_version,
        country_mapping_status: countryMapping.status,
      },
    },
  );

  return {
    status: "DETERMINED",
    line: updatedLine,
    resolution,
  };
}

/**
 * First-time determination only -- rejects ALREADY_DETERMINED rather
 * than silently overwriting, because emission_determination is
 * immutable once set (src/domain/shipments/types.ts's doc comment).
 * There is no DB-level trigger enforcing that immutability (unlike the
 * P4 org_id/shipment_id immutability triggers, which guard a tenancy
 * boundary): this is a workflow-ordering rule scoped to actors already
 * authorized to edit the line, so the application-layer check here,
 * combined with the audit trail both functions produce, is the
 * enforcement. Use redetermineLineEmissions for an explicit,
 * consciously-audited override.
 */
export async function determineLineEmissions(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  mapper: RegulatoryCountryMapper,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
): Promise<ResolveLineEmissionsResult> {
  return performResolution(
    supabase,
    repository,
    mapper,
    orgId,
    actorUserId,
    lineId,
    {
      allowOverwrite: false,
      auditEventType: "emission_determination.set",
    },
  );
}

/**
 * Explicit, audited replacement of an existing determination (see
 * docs/plans/MASTER_PLAN.md §18: "re-determination is an explicit
 * audited action, never automatic"). Distinct audit event type from
 * determineLineEmissions so the audit trail always shows whether a
 * line's number changed once already-visible determination was
 * replaced.
 */
export async function redetermineLineEmissions(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  mapper: RegulatoryCountryMapper,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
): Promise<ResolveLineEmissionsResult> {
  return performResolution(
    supabase,
    repository,
    mapper,
    orgId,
    actorUserId,
    lineId,
    {
      allowOverwrite: true,
      auditEventType: "emission_determination.redetermined",
    },
  );
}
