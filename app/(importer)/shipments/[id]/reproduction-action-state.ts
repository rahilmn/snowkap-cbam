// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.
//
// Wraps reproduceCalculationResult's own ReproductionResult
// (src/application/calculations/reproduce-calculation-result.ts) as the
// "checked" payload rather than re-declaring its four variants here --
// the same "flow the domain service's own outcome through the action
// state almost verbatim" shape resolve-emissions-action-state.ts uses
// for resolveLineEmissions's UNRESOLVED case, so a future change to
// ReproductionResult's own variants can't silently drift out of sync
// with what this file expects the UI to handle.
import type {
  ReproductionResult,
} from "../../../../src/application/calculations/reproduce-calculation-result";

export interface ReproductionActionState {
  status: "idle" | "error" | "checked";
  message?: string;

  // Set only alongside status "checked" -- the action ran to
  // completion (auth/org-context checks passed) and this is
  // reproduceCalculationResult's own outcome, verbatim.
  result?: ReproductionResult;
}

export const initialReproductionActionState: ReproductionActionState = {
  status: "idle",
};
