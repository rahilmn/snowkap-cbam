import type {
  Declaration,
} from "../../domain/declarations/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

// A single string literal, not a `+`-concatenated one -- deliberately,
// matching shipment-mapper.ts's own SHIPMENT_COLUMNS exactly: supabase-js's
// typed .select() parses this string AT THE TYPE LEVEL to infer the
// returned row shape, which only works against a literal type. A
// `+`-joined string widens to plain `string`, which breaks that
// inference (found via `pnpm typecheck`, not by reading the docs --
// every .select(DECLARATION_COLUMNS) call site failed with
// "Conversion of type 'GenericStringError[]'... may be a mistake").
export const DECLARATION_COLUMNS =
  "id, org_id, reporting_period_kind, reporting_period_year, reporting_period_quarter, status, member_shipment_ids, completeness_report, filed_snapshot, filed_reference, filed_at, supersedes_declaration_id, created_by_user_id, created_at, updated_at";

export interface DeclarationRow {
  id: string;
  org_id: string;
  reporting_period_kind: "ANNUAL" | "QUARTERLY";
  reporting_period_year: number;
  reporting_period_quarter: 1 | 2 | 3 | 4 | null;
  status: Declaration["status"];
  member_shipment_ids: string[] | null;
  completeness_report: Declaration["completeness_report"];
  filed_snapshot: Declaration["filed_snapshot"];
  filed_reference: string | null;
  filed_at: string | null;
  supersedes_declaration_id: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// Same ANNUAL/QUARTERLY split as shipment-mapper.ts's own toReportingPeriod
// and list-period-shipment-lines.ts's own (private) periodFilterColumns --
// each file owns its own copy keyed to the Row type it maps, per that
// file's own doc comment, rather than a shared cross-module helper.
function toReportingPeriod(
  row: Pick<DeclarationRow, "reporting_period_kind" | "reporting_period_year" | "reporting_period_quarter">,
): ReportingPeriod {
  if (row.reporting_period_kind === "ANNUAL") {
    return {
      kind: "ANNUAL",
      year: row.reporting_period_year,
    };
  }

  return {
    kind: "QUARTERLY",
    year: row.reporting_period_year,
    quarter: row.reporting_period_quarter as 1 | 2 | 3 | 4,
  };
}

export function toDeclaration(
  row: DeclarationRow,
): Declaration {
  return {
    id: row.id as Declaration["id"],
    org_id: row.org_id as Declaration["org_id"],
    reporting_period: toReportingPeriod(
      row,
    ),
    status: row.status,
    member_shipment_ids: (row.member_shipment_ids ?? []) as Declaration["member_shipment_ids"],
    completeness_report: row.completeness_report,
    filed_snapshot: row.filed_snapshot,
    filed_reference: row.filed_reference,
    filed_at: row.filed_at as Declaration["filed_at"],
    supersedes_declaration_id: row.supersedes_declaration_id as Declaration["supersedes_declaration_id"],
    created_by_user_id: row.created_by_user_id as Declaration["created_by_user_id"],
    created_at: row.created_at as Declaration["created_at"],
    updated_at: row.updated_at as Declaration["updated_at"],
  };
}

export interface DeclarationPeriodColumns {
  reporting_period_kind: "ANNUAL" | "QUARTERLY";
  reporting_period_year: number;
  reporting_period_quarter: 1 | 2 | 3 | 4 | null;
}

/**
 * Shared by every file in this module that filters `declarations` or
 * `shipments` by period (compute-declaration-draft-facts.ts's
 * supplementary shipments query, generate-or-refresh-declaration-draft.ts's
 * existing-DRAFT lookup, create-declaration-amendment.ts's period
 * carry-over onto the new row). Unlike shipment-mapper.ts and
 * list-period-shipment-lines.ts's own independent copies of this same
 * ANNUAL/QUARTERLY split -- each guarding a DIFFERENT table's Row type,
 * per their own doc comments -- every caller in THIS module filters
 * against the SAME two tables (`declarations`, `shipments`), whose
 * reporting_period_* columns are identical by deliberate design
 * (20260829330000's own header comment: "Mirrors shipments' own
 * reporting-period shape 1:1"). One shared helper here is that same
 * file-ownership rule's own conclusion, not an exception to it.
 */
export function periodColumns(
  period: ReportingPeriod,
): DeclarationPeriodColumns {
  if (period.kind === "ANNUAL") {
    return {
      reporting_period_kind: "ANNUAL",
      reporting_period_year: period.year,
      reporting_period_quarter: null,
    };
  }

  return {
    reporting_period_kind: "QUARTERLY",
    reporting_period_year: period.year,
    reporting_period_quarter: period.quarter,
  };
}
