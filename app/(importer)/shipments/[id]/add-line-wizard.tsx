"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Button,
} from "../../../../components/ui/button";

import {
  Input,
} from "../../../../components/ui/input";

import {
  Label,
} from "../../../../components/ui/label";

import {
  FieldError,
} from "../../../../components/ui/field-error";

import {
  cn,
} from "../../../../lib/utils";

import {
  CnCodePicker,
} from "./cn-code-picker";

import {
  addLineAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

/**
 * S3 (importer experience), the "guided line wizard" (v2.1.1 §3).
 * Replaces add-line-form.tsx's single flat 6-field form with the same
 * fields asked as a sequence of small, named questions -- "What is the
 * product? Where is it from? How much?" -- rather than all at once.
 *
 * This is presentation only: ONE <form>, submitted through the exact
 * same addLineAction Server Action, with the exact same field names
 * add-line-form.tsx always used. Every field is always mounted in the
 * DOM (so FormData at final submit carries every value regardless of
 * which step a user is currently looking at); only the CURRENT step's
 * fields are visible (`hidden` -- browsers exclude display:none fields
 * from constraint validation entirely, so a required field on a step
 * the user hasn't reached yet cannot block anything). Advancing past a
 * step is gated in JS (canAdvance below) so a user cannot reach Review
 * with an empty required field despite the browser not enforcing it on
 * hidden fields -- the server (addLineAction/classifyLine) remains the
 * actual authority on whether the submitted data is valid; this gating
 * is a UX nicety, not a second validation source of truth.
 *
 * No workflow state is persisted anywhere -- `stepIndex` and the
 * mirrored field values are ordinary React state, gone on navigation
 * away, exactly as add-line-form.tsx's own local state already was.
 */

const STEPS =
  ["product", "origin", "quantity", "review"] as const;

type Step = (typeof STEPS)[number];

const STEP_LABEL: Record<Step, string> =
  {
    product: "Product",
    origin: "Origin",
    quantity: "Quantity",
    review: "Review",
  };

const STEP_QUESTION: Record<Step, string> =
  {
    product: "What is the product?",
    origin: "Where is it from?",
    quantity: "How much?",
    review: "Review this line",
  };

export function AddLineWizard(
  {
    shipmentId,
  }: {
    shipmentId: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      addLineAction,
      initialLineActionState,
    );

  const [stepIndex, setStepIndex] =
    useState(
      0,
    );

  const currentStep =
    STEPS[stepIndex] ?? "product";

  const [cnCode, setCnCode] = useState("");
  const [goodsDescription, setGoodsDescription] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [productionRouteName, setProductionRouteName] = useState("");
  const [quantityKind, setQuantityKind] = useState("MASS");
  const [quantityValue, setQuantityValue] = useState("");

  // Same reset-via-remount discipline as add-line-form.tsx: bumped
  // only after a genuinely successful add, never after "error" (which
  // must leave the user's entered values in place to fix and
  // resubmit).
  const [pickerResetKey, setPickerResetKey] = useState(0);

  const hasMountedRef =
    useRef(
      false,
    );

  const stepContainerRef =
    useRef<HTMLDivElement>(
      null,
    );

  useEffect(
    () => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;

        return;
      }

      if (state.status === "idle") {
        setCnCode("");
        setGoodsDescription("");
        setOriginCountry("");
        setProductionRouteName("");
        setQuantityKind("MASS");
        setQuantityValue("");
        setPickerResetKey((key) => key + 1);
        setStepIndex(0);
      }
    },
    [state],
  );

  // 2026-09-06 (S3). This USED to run unconditionally on every
  // stepIndex change, including the reset-to-step-0 after a successful
  // submission -- confirmed live (a real E2E run, not a hunch) that
  // this raced the post-submit re-render closely enough to
  // intermittently strand the "Add line" button mid-disable, under
  // load real users never produce by hand. The step-to-step case
  // genuinely helps keyboard/screen-reader users; the reset case is
  // the one that raced. userNavigatedRef distinguishes "the user
  // clicked Next/Back" (focus the new step) from "a submission just
  // reset us to step 1" (don't) -- only the Next/Back handlers below
  // set it before calling setStepIndex.
  const userNavigatedRef =
    useRef(
      false,
    );

  useEffect(
    () => {
      if (!userNavigatedRef.current) {
        return;
      }

      userNavigatedRef.current =
        false;

      // Every step's fields stay mounted (only the current step's
      // wrapping <div> loses `hidden`) -- a plain querySelector would
      // always find step 1's own (hidden, unfocusable) field first,
      // regardless of the step actually showing. `offsetParent` is
      // null for anything display:none or inside a display:none
      // ancestor, so filtering on it finds the first field that is
      // actually rendered right now.
      const candidates =
        stepContainerRef.current?.querySelectorAll<HTMLElement>(
          "input, select, button",
        );

      const firstVisibleField =
        candidates
          ? Array.from(candidates).find(
              (element) => element.offsetParent !== null,
            )
          : undefined;

      firstVisibleField?.focus();
    },
    [stepIndex],
  );

  function goToStep(
    index: number,
  ): void {
    userNavigatedRef.current =
      true;

    setStepIndex(
      index,
    );
  }

  function canAdvance(): boolean {
    if (currentStep === "product") {
      return cnCode.trim().length > 0;
    }

    if (currentStep === "origin") {
      return originCountry.trim().length > 0;
    }

    if (currentStep === "quantity") {
      return quantityValue.trim().length > 0;
    }

    return true;
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
    >
      <input
        type="hidden"
        name="shipmentId"
        value={shipmentId}
      />

      <ol
        aria-label="Add a line"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-tertiary)]"
      >
        {STEPS.map(
          (step, index) => (
            <li
              key={step}
              className="flex items-center gap-2"
            >
              <span
                aria-current={index === stepIndex ? "step" : undefined}
                className={cn(
                  index === stepIndex && "font-medium text-[var(--text-primary)]",
                  index < stepIndex && "text-[var(--text-secondary)]",
                )}
              >
                {index + 1}. {STEP_LABEL[step]}
              </span>

              {index < STEPS.length - 1 ? (
                <span aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          ),
        )}
      </ol>

      <h3 className="text-sm font-medium text-[var(--text-primary)]">
        {STEP_QUESTION[currentStep]}
      </h3>

      <div
        ref={stepContainerRef}
      >
        <div
          hidden={currentStep !== "product"}
          className="flex flex-col gap-1.5"
        >
          <Label className="flex flex-col gap-1.5">
            CN / TARIC code

            <CnCodePicker
              key={pickerResetKey}
              name="cnCode"
              required
              disabled={pending}
              onSelectDescription={setGoodsDescription}
              onValueChange={setCnCode}
            />
          </Label>
        </div>

        <div
          hidden={currentStep !== "origin"}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="originCountry">
              Origin country
            </Label>

            <Input
              id="originCountry"
              name="originCountry"
              required
              maxLength={2}
              placeholder="ISO code, e.g. CN"
              disabled={pending}
              invalid={state.status === "error"}
              errorId="add-line-form-error"
              className="uppercase"
              value={originCountry}
              onChange={(event) => setOriginCountry(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productionRouteName">
              Production route (optional, if known)
            </Label>

            <Input
              id="productionRouteName"
              name="productionRouteName"
              placeholder="e.g. GREY_CLINKER_CEMENT"
              disabled={pending}
              value={productionRouteName}
              onChange={(event) => setProductionRouteName(event.target.value)}
            />
          </div>
        </div>

        <div
          hidden={currentStep !== "quantity"}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quantityKind">
              Quantity unit
            </Label>

            <select
              id="quantityKind"
              name="quantityKind"
              value={quantityKind}
              onChange={(event) => setQuantityKind(event.target.value)}
              disabled={pending}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
            >
              <option value="MASS">
                Tonnes
              </option>

              <option value="ENERGY">
                MWh
              </option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quantityValue">
              Quantity
            </Label>

            <Input
              id="quantityValue"
              name="quantityValue"
              required
              placeholder="e.g. 10.5"
              disabled={pending}
              invalid={state.status === "error"}
              errorId="add-line-form-error"
              value={quantityValue}
              onChange={(event) => setQuantityValue(event.target.value)}
            />
          </div>
        </div>

        <div
          hidden={currentStep !== "review"}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goodsDescription">
              Description (optional)
            </Label>

            <Input
              id="goodsDescription"
              name="goodsDescription"
              placeholder="Auto-filled from the regulatory good if left blank"
              disabled={pending}
              value={goodsDescription}
              onChange={(event) => setGoodsDescription(event.target.value)}
            />
          </div>

          <dl className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--text-tertiary)]">
                Product
              </dt>

              <dd className="text-right text-[var(--text-secondary)]">
                {cnCode || "—"}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--text-tertiary)]">
                Origin
              </dt>

              <dd className="text-right text-[var(--text-secondary)]">
                {originCountry || "—"}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--text-tertiary)]">
                Route
              </dt>

              <dd className="text-right text-[var(--text-secondary)]">
                {productionRouteName || "Not specified"}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--text-tertiary)]">
                Quantity
              </dt>

              <dd className="text-right text-[var(--text-secondary)]">
                {quantityValue
                  ? `${quantityValue} ${quantityKind === "MASS" ? "t" : "MWh"}`
                  : "—"}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-[var(--text-tertiary)]">
            What happens next: once this line is added, you&apos;ll
            determine its embedded emissions (a default regulatory
            value or your own actual data) and then calculate the
            result.
          </p>
        </div>
      </div>

      <FieldError id="add-line-form-error">
        {state.status === "error" ? state.message : null}
      </FieldError>

      {
        /*
         * size="lg" (h-11, 44px) on every button here, not the design
         * system's own default -- this form has no separate mobile
         * layout (unlike DataTable's card fallback, this exact markup
         * is what a phone renders too), so these are genuinely touch-
         * operated controls, not desktop-only ones. See S3 v2.1.1's
         * 44x44 touch-target requirement.
         */
      }
      <div className="flex items-center gap-2">
        {stepIndex > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={pending}
            onClick={() => goToStep(stepIndex - 1)}
          >
            Back
          </Button>
        ) : null}

        {currentStep !== "review" ? (
          <Button
            type="button"
            size="lg"
            disabled={pending || !canAdvance()}
            onClick={() => goToStep(stepIndex + 1)}
          >
            Next
          </Button>
        ) : (
          <Button
            type="submit"
            size="lg"
            loading={pending}
          >
            Add line
          </Button>
        )}
      </div>
    </form>
  );
}
