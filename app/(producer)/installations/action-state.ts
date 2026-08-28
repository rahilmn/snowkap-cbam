// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file. One shared state shape covers all four
// mutations on this screen (create/remove operator, create/remove
// installation) -- they all just need "idle" vs "error" + a message,
// matching SupplierActionState's shape in app/(importer)/suppliers/.

export interface InstallationsScreenActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialInstallationsScreenActionState: InstallationsScreenActionState = {
  status: "idle",
};
