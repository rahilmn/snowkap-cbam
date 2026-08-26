import type { CbamSector, ProductionRoute } from "./types.js";

export type TradeCodeType = "HS_HEADING" | "HS_SUBHEADING" | "CN" | "TARIC";
export interface TradeCode {
  code: string;
  codeType: TradeCodeType;
  sourceCode: string;
}

export interface DefaultEmissionValue {
  id: string;

  datasetId: string;

  originCountryCode: string;
  originCountryName: string;

  tradeCode: TradeCode;

  sector: CbamSector;

  productName: string;

  directEmissions: string | null;
  indirectEmissions: string | null;
  totalEmissions: string | null;

  unit: "TCO2E_PER_TONNE" | "TCO2_PER_MWH";

  productionRoute: ProductionRoute | null;
  sourceProductionRouteCode: string | null;

  sourceSheet: string;
  sourceRow: number;
}
