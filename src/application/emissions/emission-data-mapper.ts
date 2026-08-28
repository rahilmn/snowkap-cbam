import type {
  EmissionData,
  EmissionDataMethodology,
  EmissionDataRecordStatus,
  VerificationStatus,
} from "../../domain/emissions/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

/**
 * Flat reporting_period_kind/_year/_quarter columns, mirroring
 * shipments' own established pattern (see
 * src/application/shipments/shipment-mapper.ts and the header comment
 * on 20260828150000_p4_shipment_intake_schema.sql) rather than a
 * nested jsonb period -- ReportingPeriod is always reconstructed from
 * these three columns, never stored pre-serialized.
 */
export interface EmissionDataRow {
  id: string;
  installation_id: string;
  entered_by_org_id: string;
  cn_scope: string[];
  reporting_period_kind: "ANNUAL" | "QUARTERLY";
  reporting_period_year: number;
  reporting_period_quarter: 1 | 2 | 3 | 4 | null;
  direct_specific: string;
  indirect_specific: string;
  emission_unit: string;
  methodology: string;
  verification_status: string;
  verifier_user_id: string | null;
  rejection_reason: string | null;
  evidence_file_ids: string[];
  version: number;
  predecessor_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export const EMISSION_DATA_COLUMNS =
  "id, installation_id, entered_by_org_id, cn_scope, reporting_period_kind, reporting_period_year, reporting_period_quarter, direct_specific, indirect_specific, emission_unit, methodology, verification_status, verifier_user_id, rejection_reason, evidence_file_ids, version, predecessor_id, status, created_at, updated_at";

function toReportingPeriod(
  row: Pick<EmissionDataRow, "reporting_period_kind" | "reporting_period_year" | "reporting_period_quarter">,
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

/**
 * The inverse of toReportingPeriod -- the three flat columns an
 * insert/query needs from a ReportingPeriod. Shared by recordEmissionData
 * (the columns to write) and activateEmissionData (the filter to find a
 * prior ACTIVE row for the same installation+period), so the two stay
 * in exact sync rather than each re-deriving the ANNUAL/QUARTERLY split
 * independently.
 */
export function reportingPeriodColumns(
  period: ReportingPeriod,
): Pick<EmissionDataRow, "reporting_period_kind" | "reporting_period_year" | "reporting_period_quarter"> {
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

export function toEmissionData(
  row: EmissionDataRow,
): EmissionData {
  return {
    id: row.id as EmissionData["id"],
    installation_id: row.installation_id as EmissionData["installation_id"],
    entered_by_org_id: row.entered_by_org_id as EmissionData["entered_by_org_id"],
    cn_scope: row.cn_scope,
    period: toReportingPeriod(row),
    direct_specific: row.direct_specific as EmissionData["direct_specific"],
    indirect_specific: row.indirect_specific as EmissionData["indirect_specific"],
    emission_unit: row.emission_unit,
    methodology: row.methodology as EmissionDataMethodology,
    verification_status: row.verification_status as VerificationStatus,
    verifier_user_id: row.verifier_user_id as EmissionData["verifier_user_id"],
    rejection_reason: row.rejection_reason,
    evidence_file_ids: row.evidence_file_ids,
    version: row.version,
    predecessor_id: row.predecessor_id as EmissionData["predecessor_id"],
    status: row.status as EmissionDataRecordStatus,
    created_at: row.created_at as EmissionData["created_at"],
    updated_at: row.updated_at as EmissionData["updated_at"],
  };
}
