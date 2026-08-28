// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface OnboardingActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialOnboardingActionState: OnboardingActionState = {
  status: "idle",
};
