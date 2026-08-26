export type CbamSector =
  | "CEMENT"
  | "FERTILISERS"
  | "IRON_STEEL"
  | "ALUMINIUM"
  | "HYDROGEN"
  | "ELECTRICITY";

export interface DefaultValueMarkup {
  sector: CbamSector;

  effectiveFrom: number;
  effectiveTo?: number;

  markup: string;

  sourceId: string;
}
