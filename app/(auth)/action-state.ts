// Separate from actions.ts deliberately: a "use server" file may only
// export async functions (Next.js enforces this at build/runtime --
// "A 'use server' file can only export async functions, found
// object"), so the shared state type/initial value the client form
// components need can't live alongside the action functions
// themselves.

export interface AuthActionState {
  status: "idle" | "error" | "check-email";
  message?: string;
}

export const initialAuthActionState: AuthActionState = {
  status: "idle",
};
