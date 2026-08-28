// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface LineActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialLineActionState: LineActionState = {
  status: "idle",
};
