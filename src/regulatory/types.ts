export type CbamSector =
  | "CEMENT"
  | "FERTILISERS"
  | "IRON_STEEL"
  | "ALUMINIUM"
  | "HYDROGEN"
  | "ELECTRICITY";

export type ProductionRoute =
  | "BF_BOF"
  | "DRI_EAF"
  | "SCRAP_EAF"
  | "PRIMARY_ALUMINIUM"
  | "SECONDARY_ALUMINIUM"
  | "GREY_CLINKER"
  | "WHITE_CLINKER"
  | "OTHER"
  | "UNKNOWN";

export type RegulatorySourceType =
  | "REGULATION"
  | "IMPLEMENTING_REGULATION"
  | "OFFICIAL_DATASET"
  | "COMMISSION_GUIDANCE"
  | "SNOWKAP_ASSUMPTION";

export interface RegulatorySource {
  id: string;
  code: string;
  title: string;
  sourceType: RegulatorySourceType;
  publicationDate: string;
  effectiveFrom: string;
  effectiveTo?: string;
  officialUrl?: string;
  version: string;
}

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
