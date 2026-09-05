"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  Button,
} from "../../components/ui/button";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  Label,
} from "../../components/ui/label";

import {
  submitFeedbackAction,
} from "./actions";

import {
  initialFeedbackActionState,
} from "./action-state";

const RATING_OPTIONS =
  [1, 2, 3, 4, 5];

export function FeedbackForm(
  {
    page,
  }: {
    page: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      submitFeedbackAction,
      initialFeedbackActionState,
    );

  const [
    rating,
    setRating,
  ] =
    useState<number | null>(
      null,
    );

  return (
    <form
      action={formAction}
      className="flex w-full max-w-md flex-col gap-4"
    >
      <input
        type="hidden"
        name="page"
        value={page}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-[var(--text-primary)]">
          How would you rate this?
        </legend>

        <div
          role="radiogroup"
          aria-label="Rating"
          className="flex gap-2"
        >
          {RATING_OPTIONS.map(
            (value) => (
              <label
                key={value}
                className="flex size-10 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-sm font-medium text-[var(--text-primary)] has-[:checked]:border-[var(--accent-interactive)] has-[:checked]:bg-[var(--surface-sunken)]"
              >
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  className="sr-only"
                  required
                />

                {value}
              </label>
            ),
          )}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="comment">
          Anything you'd like to add? (optional)
        </Label>

        <textarea
          id="comment"
          name="comment"
          rows={4}
          maxLength={2000}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </div>

      <FieldError id="feedback-form-error">
        {state.status === "error" ? state.message : null}
      </FieldError>

      {state.status === "success" ? (
        <p
          role="status"
          className="text-sm text-[var(--color-success-700)]"
        >
          {state.message}
        </p>
      ) : null}

      <Button
        type="submit"
        loading={pending}
      >
        Send feedback
      </Button>
    </form>
  );
}
