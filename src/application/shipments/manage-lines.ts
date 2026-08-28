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
  CnCodeLevel,
  ShipmentLine,
  ShipmentLineProductionRoute,
} from "../../domain/shipments/types";

import type {
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
  UserId,
} from "../../domain/shared/ids";

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
  cnCodeLevel: CnCodeLevel;
  goodsDescription: string | null;
  originCountry: string;
  quantity: LineQuantityInput;
  productionRoute: ShipmentLineProductionRoute | null;
}

export type ManageLineRejectionReason =
  | "INVALID_QUANTITY"
  | "INVALID_ORIGIN_COUNTRY"
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

export async function addLine(
  supabase: SupabaseClient,
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

  const { data, error } =
    await supabase
      .from("shipment_lines")
      .insert(
        {
          shipment_id: shipmentId,
          org_id: orgId,
          line_number: nextLineNumber,
          cn_code: input.cnCode,
          cn_code_level: input.cnCodeLevel,
          goods_description: input.goodsDescription,
          origin_country: originResult.value,
          ...quantityColumns(
            input.quantity,
          ),
          production_route_name: input.productionRoute?.name ?? null,
          production_route_indicator: input.productionRoute?.source_route_indicator ?? null,
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

  const { data, error } =
    await supabase
      .from("shipment_lines")
      .update(
        {
          cn_code: input.cnCode,
          cn_code_level: input.cnCodeLevel,
          goods_description: input.goodsDescription,
          origin_country: originResult.value,
          ...quantityColumns(
            input.quantity,
          ),
          production_route_name: input.productionRoute?.name ?? null,
          production_route_indicator: input.productionRoute?.source_route_indicator ?? null,
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
