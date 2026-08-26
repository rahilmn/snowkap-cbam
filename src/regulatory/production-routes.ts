import type { CbamSector } from "./types.js";

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

export interface ProductionRouteDefinition {
  code: ProductionRoute;
  label: string;
  sector: CbamSector;
}
