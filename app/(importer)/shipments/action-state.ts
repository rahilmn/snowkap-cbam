// See app/(auth)/action-state.ts for why this lives in a separate,
// non-"use server" file.

export interface ShipmentActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialShipmentActionState: ShipmentActionState = {
  status: "idle",
};
