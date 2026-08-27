import type {
  DefaultValueResolutionInput,
  RegulatoryRecord,
} from "../../domain/regulatory/types";

export interface RegulatoryRepository {
  findActiveDefaultEmissionCandidates(
    input: DefaultValueResolutionInput,
  ): Promise<RegulatoryRecord[]>;
}