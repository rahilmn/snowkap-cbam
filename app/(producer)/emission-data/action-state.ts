// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file. One shared state shape covers every mutation
// on this screen (record / submit / verify / reject / activate /
// discard) -- they all just need "idle" vs "error" + a message,
// matching InstallationsScreenActionState's shape in
// app/(producer)/installations/.

export interface EmissionDataScreenActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialEmissionDataScreenActionState: EmissionDataScreenActionState = {
  status: "idle",
};
