"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

import {
  Button,
} from "./button";

import {
  cn,
} from "../../lib/utils";

/**
 * A confirmation step for actions that cannot be undone, or that reach
 * into another organization.
 *
 * Built on the native <dialog> element rather than a headless library:
 * showModal() gives a real focus trap, real inertness for the rest of the
 * page, and top-layer stacking that sits above the mobile navigation
 * drawer -- all of which a hand-rolled overlay has to reimplement and
 * usually gets wrong. It also adds no dependency to a codebase that has
 * deliberately avoided a component library.
 *
 * Four details that are easy to get wrong and are therefore pinned here:
 *
 * 1. React must never render the `open` attribute. An <dialog open> is a
 *    NON-modal dialog: no focus trap, no inertness, no top layer. Only
 *    showModal() produces the modal behaviour, so open/close is driven
 *    imperatively from an effect.
 *
 * 2. Escape is stopped from propagating. components/shell/mobile-nav.tsx
 *    installs a document-level keydown listener that closes the drawer on
 *    any Escape, and the dialog's own `cancel` event does not stop that
 *    keydown from bubbling -- so without this, dismissing a dialog opened
 *    from inside the drawer would close both at once.
 *
 * 3. Focus returns to whatever opened it. Browsers mostly do this, but
 *    not reliably when the opener is inside a form that re-renders, which
 *    is exactly this codebase's shape.
 *
 * 4. Cancel takes initial focus, not Confirm. The least destructive
 *    action should be the one a stray Enter press hits.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;

  /** Extra detail rendered under the description -- e.g. a preview. */
  children?: ReactNode;

  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(
  {
    open,
    title,
    description,
    children,
    confirmLabel,
    cancelLabel = "Cancel",
    variant = "default",
    confirming = false,
    onConfirm,
    onCancel,
  }: ConfirmDialogProps,
) {
  const dialogRef =
    useRef<HTMLDialogElement>(null);

  const openerRef =
    useRef<Element | null>(null);

  const titleId =
    useId();

  const descriptionId =
    useId();

  useEffect(
    () => {
      const dialog =
        dialogRef.current;

      if (!dialog) {
        return;
      }

      if (open && !dialog.open) {
        openerRef.current =
          document.activeElement;

        dialog.showModal();
      } else if (!open && dialog.open) {
        dialog.close();
      }
    },
    [open],
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Native Escape. Prevented so the dialog closes through the same
        // path as the Cancel button, and stopped from propagating so the
        // mobile drawer's own document-level Escape handler does not also
        // fire (see this component's doc comment).
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
        }
      }}
      onClose={() => {
        (openerRef.current as HTMLElement | null)?.focus?.();
      }}
      onClick={(event) => {
        // Only a click on the backdrop itself -- the dialog element's own
        // box, outside the padded content below -- dismisses.
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      className={cn(
        "m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--border-default)]",
        "bg-[var(--surface-overlay)] p-0 text-[var(--text-primary)] shadow-[var(--shadow-overlay)]",
        "backdrop:bg-black/60",
      )}
    >
      <div className="flex flex-col gap-3 p-5">
        <h2
          id={titleId}
          className="text-base font-semibold text-[var(--text-primary)]"
        >
          {title}
        </h2>

        {description ? (
          <div
            id={descriptionId}
            className="text-sm text-[var(--text-secondary)]"
          >
            {description}
          </div>
        ) : null}

        {children}

        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            autoFocus
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>

          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "primary"}
            size="sm"
            loading={confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
