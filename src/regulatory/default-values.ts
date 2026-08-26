import type { CbamSector, ProductionRoute } from "./types.js";

import type { RegulatoryNumericValue } from "./value-types.js";

export type TradeCodeType = "HS_HEADING" | "HS_SUBHEADING" | "CN" | "TARIC";

export interface TradeCode {
  code: string;
  codeType: TradeCodeType;
  sourceCode: string;
}

export interface DefaultEmissionValue {
  id: string;

  datasetId: string;

  originCountryCode: string | null;
  originCountryName: string;

  sourceSheet: string;

  tradeCode: TradeCode;

  sector: CbamSector;

  productName: string;

  directEmissions: RegulatoryNumericValue;
  indirectEmissions: RegulatoryNumericValue;
  totalEmissions: RegulatoryNumericValue;

  productionRoute: ProductionRoute | null;
  sourceProductionRouteCode: string | null;

  sourceRow: number;

  recordLevel: "HS_HEADING" | "HS_SUBHEADING" | "TRADE_GOOD";
}
