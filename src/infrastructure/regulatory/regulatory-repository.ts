import type {
  DefaultValueResolutionInput,
  RegulatoryRecord,
} from "../../domain/regulatory/types.js";

export interface RegulatoryRepository {
  findActiveDefaultEmissionCandidates(
    input: DefaultValueResolutionInput,
  ): Promise<RegulatoryRecord[]>;
}