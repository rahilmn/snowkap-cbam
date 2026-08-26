export type RegulatoryDatasetType =
  | "CBAM_GOODS"
  | "DEFAULT_EMISSION_VALUES"
  | "CBAM_BENCHMARKS"
  | "CBAM_FACTORS"
  | "CSCF"
  | "CERTIFICATE_PRICES"
  | "COUNTRIES"
  | "EXEMPTIONS";

export interface RegulatoryDataset {
  id: string;
  sourceId: string;

  datasetType: RegulatoryDatasetType;
  version: string;

  effectiveFrom: string;
  effectiveTo?: string;

  importedAt: string;

  checksum?: string;

  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
}
