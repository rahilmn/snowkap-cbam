// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface LineActionState {
  // "unchanged" (2026-09-03, P14): the action ran, found that doing what
  // was asked would produce a result materially identical to what the
  // line already carries, and deliberately did nothing. That is neither
  // a success worth confirming nor a failure worth alarming about, and
  // collapsing it into "error" would tell the user something went wrong
  // when nothing did. It renders neutral.
  status: "idle" | "unchanged" | "error";
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
