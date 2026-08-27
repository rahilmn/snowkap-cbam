import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
} from "../../domain/regulatory/types";

import {
  resolveDefaultValue,
} from "../../domain/regulatory/resolve-default-value";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

export async function resolveActiveDefaultValue(
  repository: RegulatoryRepository,
  input: DefaultValueResolutionInput,
): Promise<DefaultValueResolutionResult> {
  const records =
    await repository.findActiveDefaultEmissionCandidates(
      input,
    );

  return resolveDefaultValue(
    records,
    input,
  );
}