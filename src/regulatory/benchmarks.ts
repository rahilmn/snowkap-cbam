import type { CbamSector, ProductionRoute } from "./types.js";
export interface CbamBenchmark {
  id: string;

  datasetId: string;

  cnCode: string;
  sector: CbamSector;

  productionRoute?: ProductionRoute;

  benchmarkValue: string;
  unit: "TCO2E_PER_TONNE";

  effectiveFrom: string;
  effectiveTo?: string;
}
