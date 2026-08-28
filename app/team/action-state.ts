// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface TeamActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialTeamActionState: TeamActionState = {
  status: "idle",
};
