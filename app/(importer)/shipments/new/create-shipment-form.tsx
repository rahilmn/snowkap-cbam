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
  createShipmentAction,
} from "../actions";

import {
  initialShipmentActionState,
} from "../action-state";

export function CreateShipmentForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      createShipmentAction,
      initialShipmentActionState,
    );

  return (
    <form
      action={formAction}
      className="flex w-full max-w-md flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reference">
          Reference
        </Label>

        <Input
          id="reference"
          name="reference"
          required
          placeholder="e.g. SHIP-2026-001"
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="releaseDate">
          Release date
        </Label>

        <Input
          id="releaseDate"
          name="releaseDate"
          type="date"
          required
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customsMrn">
          Customs MRN
        </Label>

        <Input
          id="customsMrn"
          name="customsMrn"
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customsProcedure">
          Customs procedure
        </Label>

        <select
          id="customsProcedure"
          name="customsProcedure"
          defaultValue=""
          disabled={pending}
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
        >
          <option value="">
            Not specified
          </option>

          <option value="RELEASE_FOR_FREE_CIRCULATION">
            Release for free circulation
          </option>

          <option value="INWARD_PROCESSING">
            Inward processing
          </option>
        </select>
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
        className="w-fit"
      >
        Create shipment
      </Button>
    </form>
  );
}
