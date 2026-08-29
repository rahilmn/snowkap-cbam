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
  CnCodePicker,
} from "./cn-code-picker";

import {
  addLineAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

export function AddLineForm(
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

  // Auto-filled from the picked good's own description on selection --
  // still a plain editable field afterward (the user can override it),
  // and the server still auto-fills from the classified good when this
  // is left blank at submit time either way (addLineAction), so this
  // is a same-tick UX nicety layered on an unchanged fallback.
  const [goodsDescription, setGoodsDescription] =
    useState(
      "",
    );

  // CnCodePicker resets its own visible/submitted text via this key --
  // remounting it is simpler and more robust than threading a reset
  // callback into a component that already owns its own search-query
  // state. Bumped only after a genuinely successful add (never after
  // "error", which must leave the user's typed values in place to
  // fix and resubmit) -- skipping the very first render, since
  // useActionState's initial state and a real "just succeeded" state
  // are otherwise indistinguishable (both are {status: "idle"}).
  const [pickerResetKey, setPickerResetKey] =
    useState(
      0,
    );

  const hasMountedRef =
    useRef(
      false,
    );

  useEffect(
    () => {
      if (!hasMountedRef.current) {
        hasMountedRef.current =
          true;

        return;
      }

      if (state.status === "idle") {
        setGoodsDescription(
          "",
        );

        setPickerResetKey(
          (key) => key + 1,
        );
      }
    },
    [state],
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
    >
      <input
        type="hidden"
        name="shipmentId"
        value={shipmentId}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          {/*
            Implicit label association (wrapping, no htmlFor/id pair) --
            cmdk's CommandInput always overwrites a caller-supplied id
            with its own internally-generated one (see cn-code-picker.tsx's
            own doc comment), so an explicit htmlFor="cnCode" would point
            at an id that never actually lands on the input. Wrapping
            needs no id from the child at all and is an equally valid,
            WCAG-compliant association.
          */}
          <Label className="flex flex-col gap-1.5">
            CN / TARIC code
            <CnCodePicker
              key={pickerResetKey}
              name="cnCode"
              required
              disabled={pending}
              onSelectDescription={setGoodsDescription}
            />
          </Label>
        </div>

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
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quantityKind">
            Quantity unit
          </Label>

          <select
            id="quantityKind"
            name="quantityKind"
            defaultValue="MASS"
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
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productionRouteName">
            Production route (optional)
          </Label>

          <Input
            id="productionRouteName"
            name="productionRouteName"
            placeholder="e.g. GREY_CLINKER_CEMENT"
            disabled={pending}
          />
        </div>
      </div>

      <FieldError id="add-line-form-error">
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
        className="w-fit"
      >
        Add line
      </Button>
    </form>
  );
}
