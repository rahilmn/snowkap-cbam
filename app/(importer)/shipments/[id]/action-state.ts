// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface LineActionState {
  status: "idle" | "error";
  message?: string;

  // Set only alongside status "idle" -- the action itself succeeded
  // (never blocks or downgrades to "error"), but something non-fatal
  // about it is worth surfacing rather than silently discarding. First
  // use: determineFromActualDataAction, when a cross-org determination
  // succeeded but record_shared_data_consumption (the grantor-side
  // audit RPC, S8) failed -- see DetermineFromActualDataResult's own
  // crossOrgConsumptionRecorded field for why that must not fail the
  // whole determination.
  warning?: string;
}

export const initialLineActionState: LineActionState = {
  status: "idle",
};
