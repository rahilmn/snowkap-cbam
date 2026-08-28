// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface SupplierActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialSupplierActionState: SupplierActionState = {
  status: "idle",
};
