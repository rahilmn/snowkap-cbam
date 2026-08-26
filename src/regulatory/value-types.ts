export type RegulatoryValueStatus =
  | "AVAILABLE"
  | "NOT_APPLICABLE"
  | "UNAVAILABLE"
  | "REFERENCE_REQUIRED"
  | "SOURCE_TEXT";

export interface RegulatoryNumericValue {
  value: string | null;

  status: RegulatoryValueStatus;

  rawSourceValue: string | null;
}
