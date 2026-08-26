import type { CbamSector } from "./types.js";
export interface ExemptionRule {
  id: string;

  sector: CbamSector;

  thresholdValue?: string;
  thresholdUnit?: "TONNES";

  aggregationLevel: "IMPORTER_YEAR" | "LINE_ITEM";

  effectiveFrom: string;
  effectiveTo?: string;

  sourceId: string;
}
