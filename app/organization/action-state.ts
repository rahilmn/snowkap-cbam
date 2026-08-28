// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface OrganizationSettingsActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialOrganizationSettingsActionState: OrganizationSettingsActionState = {
  status: "idle",
};
