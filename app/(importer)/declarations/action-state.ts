// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

import type {
  CompletenessBlocker,
} from "../../../src/domain/declarations/types";

export interface DeclarationActionState {
  status: "idle" | "error";
  message?: string;

  // Present only alongside an INCOMPLETE rejection from
  // markDeclarationReady/recordDeclarationFiled -- the EXACT, named
  // blockers from that call's own fresh recompute, rendered directly
  // (WhyThisNumberPanel.tsx's own resolveState.trace is the precedent
  // for surfacing a rejection's structured detail transiently rather
  // than collapsing it to a bare message string).
  blockers?: CompletenessBlocker[];
}

export const initialDeclarationActionState: DeclarationActionState = {
  status: "idle",
};
