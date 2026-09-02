import type {
  AuthLinkKind,
} from "../auth-link-errors";

export type ConfirmLinkActionState =
  | { status: "idle" }
  | {
      status: "error";
      code: string | null;
      kind: AuthLinkKind;

      /**
       * The email of the session the browser ALREADY holds, when the link
       * failed but the caller is signed in anyway. Lets the panel offer
       * "Continue as {email}" instead of leaving someone who is in fact
       * already authenticated staring at an error -- and lets it say so
       * explicitly rather than silently carrying on as a different
       * identity.
       */
      signedInEmail: string | null;
    };

export const initialConfirmLinkActionState: ConfirmLinkActionState =
  {
    status: "idle",
  };
