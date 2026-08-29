// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file. One shared state shape covers both mutations on
// this screen (invite by email, revoke) -- matches
// InstallationsScreenActionState's shape in app/(producer)/installations/.

export interface SharingScreenActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialSharingScreenActionState: SharingScreenActionState = {
  status: "idle",
};
