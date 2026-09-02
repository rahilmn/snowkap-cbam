"use client";

import {
  useActionState,
} from "react";

import {
  Button,
} from "../../../components/ui/button";

import {
  AuthLinkErrorPanel,
} from "../auth-link-error-panel";

import {
  describeAuthLinkError,
} from "../auth-link-errors";

import {
  confirmEmailLinkAction,
} from "./actions";

import {
  initialConfirmLinkActionState,
} from "./action-state";

/**
 * Deliberately has NO auto-submit. No useEffect that submits, no
 * requestSubmit, no autoFocus on the submit control -- the token is
 * consumed only when a human presses Continue.
 *
 * That is the entire point of this screen. A link opened by a mail
 * security scanner, a link preview or a prefetch renders this page and
 * changes nothing; the single-use token survives for the recipient. It
 * happened to a real invitee on 2026-09-02, whose invitation token was
 * consumed 76 seconds after delivery by something that was not their
 * click.
 *
 * tests/architecture/auth-confirm-get-is-inert.test.ts asserts the
 * absence of those constructs against this file's source, because the
 * guarantee is a property of the code rather than of anything the type
 * system can see.
 */
export function ConfirmLinkForm(
  {
    tokenHash,
    type,
    next,
  }: {
    tokenHash: string;
    type: string;
    next: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      confirmEmailLinkAction,
      initialConfirmLinkActionState,
    );

  if (state.status === "error") {
    return (
      <AuthLinkErrorPanel
        copy={
          describeAuthLinkError(
            {
              code: state.code,
              kind: state.kind,
            },
          )
        }
        signedInEmail={state.signedInEmail}
        continueHref={next}
      />
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
    >
      <input
        type="hidden"
        name="token_hash"
        value={tokenHash}
      />

      <input
        type="hidden"
        name="type"
        value={type}
      />

      <input
        type="hidden"
        name="next"
        value={next}
      />

      <Button
        type="submit"
        variant="primary"
        loading={pending}
      >
        Continue
      </Button>
    </form>
  );
}
