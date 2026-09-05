// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface FeedbackActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export const initialFeedbackActionState: FeedbackActionState = {
  status: "idle",
};
