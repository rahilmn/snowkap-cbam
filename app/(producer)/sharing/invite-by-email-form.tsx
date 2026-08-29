"use client";

import {
  useActionState,
} from "react";

import {
  Share2,
} from "lucide-react";

import {
  Button,
} from "../../../components/ui/button";

import {
  Input,
} from "../../../components/ui/input";

import {
  Label,
} from "../../../components/ui/label";

import {
  FieldError,
} from "../../../components/ui/field-error";

import {
  inviteByEmailAction,
} from "./actions";

import {
  initialSharingScreenActionState,
} from "./action-state";

export interface InstallationOption {
  id: string;
  name: string;
}

export function InviteByEmailForm(
  {
    installations,
  }: {
    installations: InstallationOption[];
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      inviteByEmailAction,
      initialSharingScreenActionState,
    );

  if (installations.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        Add an installation first, then share its data here.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-b border-[var(--border-default)] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-grant-installationId">
            Installation
          </Label>

          <select
            id="invite-grant-installationId"
            name="installationId"
            required
            disabled={pending}
            defaultValue=""
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="" disabled>
              Choose installation
            </option>

            {installations.map(
              (installation) => (
                <option
                  key={installation.id}
                  value={installation.id}
                >
                  {installation.name}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-grant-email">
            Importer's email
          </Label>

          <Input
            id="invite-grant-email"
            name="email"
            type="email"
            required
            placeholder="name@importer.com"
            disabled={pending}
          />
        </div>

        <Button
          type="submit"
          loading={pending}
        >
          <Share2
            className="size-4"
            aria-hidden="true"
          />

          Invite to view data
        </Button>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        The invited importer accepts once signed in with a matching
        email -- see /accept-invitation.
      </p>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>
    </form>
  );
}
