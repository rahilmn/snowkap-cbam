export interface CbamGood {
  id: string;

  cnCode: string;
  description: string;

  sector:
    | "CEMENT"
    | "FERTILISERS"
    | "IRON_STEEL"
    | "ALUMINIUM"
    | "HYDROGEN"
    | "ELECTRICITY";

  functionalUnit: "TONNES" | "MWH";

  directEmissionsApplicable: boolean;
  indirectEmissionsApplicable: boolean;

  isComplexGood: boolean;

  activeFrom: string;
  activeTo?: string;
}
