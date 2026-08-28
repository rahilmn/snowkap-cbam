"use client";

import {
  useActionState,
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
          <Label htmlFor="cnCode">
            CN / TARIC code
          </Label>

          <Input
            id="cnCode"
            name="cnCode"
            required
            placeholder="e.g. 25232100"
            disabled={pending}
          />
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

      <FieldError>
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
