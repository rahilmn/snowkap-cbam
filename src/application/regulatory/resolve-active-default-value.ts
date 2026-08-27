import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
} from "../../domain/regulatory/types.js";

import {
  resolveDefaultValue,
} from "../../domain/regulatory/resolve-default-value.js";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository.js";

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