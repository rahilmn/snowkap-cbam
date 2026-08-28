"use client";

import {
  useActionState,
} from "react";

import {
  UserPlus,
} from "lucide-react";

import {
  Button,
} from "../../components/ui/button";

import {
  Input,
} from "../../components/ui/input";

import {
  Label,
} from "../../components/ui/label";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  inviteMemberAction,
} from "./actions";

import {
  initialTeamActionState,
} from "./action-state";

export function InviteMemberForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      inviteMemberAction,
      initialTeamActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-b border-[var(--border-default)] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-email">
            Invite by email
          </Label>

          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="name@company.com"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">
            Role
          </Label>

          <select
            id="invite-role"
            name="role"
            defaultValue="MEMBER"
            disabled={pending}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="MEMBER">
              Member
            </option>

            <option value="ADMIN">
              Admin
            </option>
          </select>
        </div>

        <Button
          type="submit"
          loading={pending}
        >
          <UserPlus
            className="size-4"
            aria-hidden="true"
          />

          Send invite
        </Button>
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>
    </form>
  );
}
