// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface AcceptInvitationActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialAcceptInvitationActionState: AcceptInvitationActionState = {
  status: "idle",
};
