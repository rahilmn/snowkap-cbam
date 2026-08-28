import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import {
  classifyGood,
  requiredQuantityKind,
  validateCnCodeFormat,
  type QuantityKind,
} from "../../domain/shipments/classify-good";

import type {
  CbamGoodSummary,
} from "../../domain/regulatory/types";

import type {
  CnCodeLevel,
} from "../../domain/shipments/types";

export type ClassifyLineResult =
  | {
      status: "VALID";
      good: CbamGoodSummary;
      level: CnCodeLevel;
      requiredQuantityKind: QuantityKind;
    }
  | { status: "INVALID_FORMAT" }
  | { status: "UNSUPPORTED_CODE" }
  | { status: "AMBIGUOUS"; candidates: CbamGoodSummary[] };

/**
 * Orchestrates the §20 classification check for one declared CN/TARIC
 * code: format validation (pure, no I/O) -> fetch candidates from the
 * regulatory adapter (the ONLY place this reaches the protected
 * regulatory subsystem, read-only) -> pure decision
 * (src/domain/shipments/classify-good.ts, already unit-tested).
 * `repository` is passed in (dependency injection, matching every
 * other use-case service in this codebase) -- callers construct it via
 * src/infrastructure/regulatory/get-regulatory-repository.ts.
 */
export async function classifyLine(
  repository: RegulatoryRepository,
  declaredCode: string,
  // The shipment's own release_date, never "today" -- a line entered
  // now may declare a past release date, and a superseded
  // classification row must not be treated as a match for it. See
  // findCbamGoodsByCode's own doc comment.
  asOfDate: string,
): Promise<ClassifyLineResult> {
  const formatResult =
    validateCnCodeFormat(
      declaredCode,
    );

  if (formatResult.status === "INVALID_FORMAT") {
    return {
      status: "INVALID_FORMAT",
    };
  }

  const candidates =
    await repository.findCbamGoodsByCode(
      declaredCode,
      asOfDate,
    );

  const classification =
    classifyGood(
      candidates,
    );

  if (classification.status !== "VALID") {
    return classification;
  }

  return {
    status: "VALID",
    good: classification.good,
    level: formatResult.level,
    requiredQuantityKind: requiredQuantityKind(
      classification.good,
    ),
  };
}
