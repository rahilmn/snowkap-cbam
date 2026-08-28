import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  parseDecimalString,
} from "../../domain/shared/decimal";

import {
  parseCountryCode,
} from "../../domain/shared/country";

import type {
  ShipmentLine,
  ShipmentLineProductionRoute,
} from "../../domain/shipments/types";

import type {
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
  UserId,
} from "../../domain/shared/ids";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import {
  classifyLine,
} from "./classify-line";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  SHIPMENT_LINE_COLUMNS,
  toShipmentLine,
  type ShipmentLineRow,
} from "./shipment-mapper";

export interface LineQuantityInput {
  kind: "MASS" | "ENERGY";
  value: string;
}

export interface AddLineInput {
  cnCode: string;
  goodsDescription: string | null;
  originCountry: string;
  quantity: LineQuantityInput;
  // Just the route's display name -- the indicator that actually gets
  // stored is always server-resolved against findProductionRoutes(),
  // never taken from the caller (ADR-0010 discipline: never trust a
  // client-claimed indicator).
  productionRouteName: string | null;
}

export type ManageLineRejectionReason =
  | "INVALID_CN_CODE_FORMAT"
  | "UNSUPPORTED_CODE"
  | "AMBIGUOUS_CODE"
  | "QUANTITY_UNIT_MISMATCH"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_AMBIGUOUS"
  | "INVALID_QUANTITY"
  | "INVALID_ORIGIN_COUNTRY"
  | "SHIPMENT_NOT_FOUND"
  | "FETCH_FAILED"
  | "PERSIST_FAILED"
  | "SHIPMENT_NOT_EDITABLE";

export type ManageLineResult =
  | { status: "OK"; line: ShipmentLine }
  | { status: "REJECTED"; reason: ManageLineRejectionReason };

export type RemoveLineResult =
  | { status: "OK" }
  | { status: "REJECTED"; reason: ManageLineRejectionReason };

function quantityColumns(
  quantity: LineQuantityInput,
): { net_mass_tonnes: string | null; quantity_mwh: string | null } {
  return quantity.kind === "MASS"
    ? { net_mass_tonnes: quantity.value, quantity_mwh: null }
    : { net_mass_tonnes: null, quantity_mwh: quantity.value };
}

/**
 * PERSIST_FAILED vs SHIPMENT_NOT_EDITABLE: a plain Postgres error
 * (constraint violation, connectivity) is PERSIST_FAILED; an RLS
 * rejection (42501, or an update/delete that silently affects 0 rows
 * because the parent shipment is LOCKED/VOID -- see
 * 20260828150000_p4_shipment_intake_schema.sql's
 * shipment_lines_*_parent_not_terminal policies) is surfaced as the
 * more specific, actionable SHIPMENT_NOT_EDITABLE.
 */
function classifyLineWriteError(
  error: { code?: string } | null,
): "PERSIST_FAILED" | "SHIPMENT_NOT_EDITABLE" {
  return error?.code === "42501"
    ? "SHIPMENT_NOT_EDITABLE"
    : "PERSIST_FAILED";
}

interface ResolvedClassification {
  cnCodeLevel: "CN8" | "TARIC10";
  goodsDescription: string | null;
  productionRoute: ShipmentLineProductionRoute | null;
}

/**
 * The shared validate-and-classify pipeline for addLine/updateLine:
 * format check -> classifyLine (regulatory existence + level,
 * §20) -> quantity-kind match -> route resolution (server-verified
 * indicator, never client-supplied). Returns either the fields that
 * only the regulatory subsystem can determine, or the specific
 * rejection reason -- callers just persist on success.
 */
async function resolveLineClassification(
  repository: RegulatoryRepository,
  releaseDate: string,
  input: Pick<AddLineInput, "cnCode" | "goodsDescription" | "quantity" | "productionRouteName">,
): Promise<
  | { status: "OK"; resolved: ResolvedClassification }
  | { status: "REJECTED"; reason: ManageLineRejectionReason }
> {
  const classification =
    await classifyLine(
      repository,
      input.cnCode,
      releaseDate,
    );

  if (classification.status === "INVALID_FORMAT") {
    return {
      status: "REJECTED",
      reason: "INVALID_CN_CODE_FORMAT",
    };
  }

  if (classification.status === "UNSUPPORTED_CODE") {
    return {
      status: "REJECTED",
      reason: "UNSUPPORTED_CODE",
    };
  }

  if (classification.status === "AMBIGUOUS") {
    return {
      status: "REJECTED",
      reason: "AMBIGUOUS_CODE",
    };
  }

  const requiredKind =
    classification.requiredQuantityKind === "ENERGY"
      ? "ENERGY"
      : "MASS";

  if (input.quantity.kind !== requiredKind) {
    return {
      status: "REJECTED",
      reason: "QUANTITY_UNIT_MISMATCH",
    };
  }

  let productionRoute: ShipmentLineProductionRoute | null =
    null;

  if (input.productionRouteName) {
    const routes =
      await repository.findProductionRoutes(
        classification.good.sector,
      );

    const matches =
      routes.filter(
        (route) => route.name === input.productionRouteName,
      );

    if (matches.length === 0) {
      return {
        status: "REJECTED",
        reason: "ROUTE_NOT_FOUND",
      };
    }

    if (matches.length > 1) {
      return {
        status: "REJECTED",
        reason: "ROUTE_AMBIGUOUS",
      };
    }

    const [route] =
      matches;

    productionRoute =
      {
        name: (route as NonNullable<typeof route>).name,
        source_route_indicator: (route as NonNullable<typeof route>).source_route_indicator,
      };
  }

  return {
    status: "OK",
    resolved: {
      cnCodeLevel: classification.level,
      goodsDescription: input.goodsDescription ?? classification.good.description,
      productionRoute,
    },
  };
}

export async function addLine(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  orgId: OrganizationId,
  actorUserId: UserId,
  shipmentId: ShipmentId,
  input: AddLineInput,
): Promise<ManageLineResult> {
  const quantityResult =
    parseDecimalString(
      input.quantity.value,
    );

  if (quantityResult.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_QUANTITY",
    };
  }

  const originResult =
    parseCountryCode(
      input.originCountry,
    );

  if (originResult.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_ORIGIN_COUNTRY",
    };
  }

  const { data: shipmentRow, error: shipmentError } =
    await supabase
      .from("shipments")
      .select("release_date")
      .eq("id", shipmentId)
      .maybeSingle();

  if (shipmentError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!shipmentRow) {
    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_FOUND",
    };
  }

  const classificationResult =
    await resolveLineClassification(
      repository,
      (shipmentRow as { release_date: string }).release_date,
      input,
    );

  if (classificationResult.status === "REJECTED") {
    return classificationResult;
  }

  const { data: existingLines, error: fetchError } =
    await supabase
      .from("shipment_lines")
      .select("line_number")
      .eq("shipment_id", shipmentId)
      .order("line_number", { ascending: false })
      .limit(1);

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const nextLineNumber =
    ((existingLines?.[0] as { line_number: number } | undefined)?.line_number ?? 0) + 1;

  const { resolved } =
    classificationResult;

  const { data, error } =
    await supabase
      .from("shipment_lines")
      .insert(
        {
          shipment_id: shipmentId,
          org_id: orgId,
          line_number: nextLineNumber,
          cn_code: input.cnCode,
          cn_code_level: resolved.cnCodeLevel,
          goods_description: resolved.goodsDescription,
          origin_country: originResult.value,
          ...quantityColumns(
            input.quantity,
          ),
          production_route_name: resolved.productionRoute?.name ?? null,
          production_route_indicator: resolved.productionRoute?.source_route_indicator ?? null,
        },
      )
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: classifyLineWriteError(
        error,
      ),
    };
  }

  const line =
    toShipmentLine(
      data as ShipmentLineRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "shipment_line.added",
      aggregateType: "SHIPMENT_LINE",
      aggregateId: line.id,
      payload: {
        shipment_id: shipmentId,
        line_number: line.line_number,
        cn_code: line.cn_code,
      },
    },
  );

  return {
    status: "OK",
    line,
  };
}

export async function updateLine(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
  input: AddLineInput,
): Promise<ManageLineResult> {
  const quantityResult =
    parseDecimalString(
      input.quantity.value,
    );

  if (quantityResult.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_QUANTITY",
    };
  }

  const originResult =
    parseCountryCode(
      input.originCountry,
    );

  if (originResult.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_ORIGIN_COUNTRY",
    };
  }

  const { data: lineRow, error: lineFetchError } =
    await supabase
      .from("shipment_lines")
      .select(
        "shipment_id, emission_determination, shipments(release_date)",
      )
      .eq("id", lineId)
      .maybeSingle();

  if (lineFetchError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!lineRow) {
    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_FOUND",
    };
  }

  const existingDetermination =
    (lineRow as { emission_determination: unknown }).emission_determination;

  const shipmentsRelation =
    (lineRow as { shipments: { release_date: string } | { release_date: string }[] | null }).shipments;

  const parentShipment =
    Array.isArray(shipmentsRelation)
      ? shipmentsRelation[0]
      : shipmentsRelation;

  if (!parentShipment) {
    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_FOUND",
    };
  }

  const classificationResult =
    await resolveLineClassification(
      repository,
      parentShipment.release_date,
      input,
    );

  if (classificationResult.status === "REJECTED") {
    return classificationResult;
  }

  const { resolved } =
    classificationResult;

  const { data, error } =
    await supabase
      .from("shipment_lines")
      .update(
        {
          cn_code: input.cnCode,
          cn_code_level: resolved.cnCodeLevel,
          goods_description: resolved.goodsDescription,
          origin_country: originResult.value,
          ...quantityColumns(
            input.quantity,
          ),
          production_route_name: resolved.productionRoute?.name ?? null,
          production_route_indicator: resolved.productionRoute?.source_route_indicator ?? null,

          // A determination is frozen against the declared code/origin/
          // quantity/route it was computed for -- editing any of those
          // makes it stale, so it is always cleared here rather than
          // carried forward silently attached to different inputs
          // (found in P5 review). Re-determining is then an explicit
          // action via src/application/emissions/resolve-line-emissions.ts,
          // same as for a brand-new line.
          emission_determination: null,
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
      reason: classifyLineWriteError(
        error,
      ),
    };
  }

  if (!data) {
    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_EDITABLE",
    };
  }

  const line =
    toShipmentLine(
      data as ShipmentLineRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "shipment_line.updated",
      aggregateType: "SHIPMENT_LINE",
      aggregateId: line.id,
      payload: {
        shipment_id: line.shipment_id,
        line_number: line.line_number,
        cn_code: line.cn_code,
        determination_cleared: existingDetermination !== null,
      },
    },
  );

  return {
    status: "OK",
    line,
  };
}

export async function removeLine(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
): Promise<RemoveLineResult> {
  const { data, error } =
    await supabase
      .from("shipment_lines")
      .delete()
      .eq("id", lineId)
      .select(
        "shipment_id, line_number",
      )
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: classifyLineWriteError(
        error,
      ),
    };
  }

  if (!data) {
    // RLS silently excludes rows the caller cannot delete (parent
    // shipment LOCKED/VOID, or the line no longer exists) rather than
    // erroring -- see the migration's shipment_lines_delete_parent_not_terminal
    // policy comment.
    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_EDITABLE",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "shipment_line.removed",
      aggregateType: "SHIPMENT_LINE",
      aggregateId: lineId,
      payload: {
        shipment_id: data.shipment_id,
        line_number: data.line_number,
      },
    },
  );

  return {
    status: "OK",
  };
}
