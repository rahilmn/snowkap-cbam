export interface OnboardingSetupActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialOnboardingSetupActionState: OnboardingSetupActionState =
  {
    status: "idle",
  };
