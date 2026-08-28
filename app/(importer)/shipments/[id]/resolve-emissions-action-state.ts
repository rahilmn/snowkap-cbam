// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.
//
// Richer than LineActionState: an UNRESOLVED outcome persists nothing
// (src/application/emissions/resolve-line-emissions.ts never writes to
// a line it couldn't determine), so the reason and trace the resolver
// produced only exist for this one render cycle -- carried on the
// action state, not re-derived from the (unchanged) line afterward.
export interface ResolveEmissionsActionState {
  status: "idle" | "error" | "unresolved";
  message?: string;
  reason?: string;
  trace?: { step: string; outcome: string }[];
}

export const initialResolveEmissionsActionState: ResolveEmissionsActionState = {
  status: "idle",
};
