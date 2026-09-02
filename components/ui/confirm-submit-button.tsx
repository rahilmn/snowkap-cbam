"use client";

import {
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Button,
  type ButtonProps,
} from "./button";

import {
  ConfirmDialog,
} from "./confirm-dialog";

/**
 * A submit button that asks first.
 *
 * Every consequential action in this product is a plain
 * `<form action={serverAction}>` driven by useActionState, so the
 * confirmation has to fit that shape rather than replace it. This
 * intercepts the click, opens a dialog, and on confirm submits the form
 * it already belongs to -- which means the Server Action, its pending
 * state, its error handling and its progressive-enhancement behaviour are
 * all untouched.
 *
 * form.requestSubmit(button) rather than form.submit(): the former fires
 * a real `submit` event (which React's form action handling listens for)
 * and runs validation; the latter bypasses both. It is also why the
 * button is NOT passed `loading` -- Button maps `loading` to `disabled`,
 * and a disabled element is not a valid submitter, so requestSubmit would
 * throw. Pending state belongs on the dialog's confirm button, where the
 * user is actually looking.
 *
 * Without JavaScript the form still submits, just unconfirmed. That is
 * the same trade-off the mobile navigation drawer already makes, and it
 * fails toward the action working rather than toward it being impossible.
 */
export interface ConfirmSubmitButtonProps
  extends Omit<ButtonProps, "type" | "onClick" | "loading"> {
  /** Rendered by the dialog while the form submission is in flight. */
  pending?: boolean;

  confirm: {
    title: string;
    description?: ReactNode;
    children?: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    variant?: "default" | "destructive";
  };
}

export function ConfirmSubmitButton(
  {
    confirm,
    pending = false,
    children,
    ...buttonProps
  }: ConfirmSubmitButtonProps,
) {
  const [open, setOpen] =
    useState(false);

  const buttonRef =
    useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        {...buttonProps}
        ref={buttonRef}
        type="submit"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </Button>

      <ConfirmDialog
        open={open}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        cancelLabel={confirm.cancelLabel}
        variant={confirm.variant}
        confirming={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);

          const button =
            buttonRef.current;

          // Submitting THROUGH the button, so a form with more than one
          // submitter still sees which one was used.
          button?.form?.requestSubmit(
            button,
          );
        }}
      >
        {confirm.children}
      </ConfirmDialog>
    </>
  );
}
