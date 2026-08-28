"use client";

import {
  useActionState,
} from "react";

import {
  UserMinus,
} from "lucide-react";

import {
  Button,
} from "../../components/ui/button";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  changeRoleAction,
  removeMemberAction,
} from "./actions";

import {
  initialTeamActionState,
} from "./action-state";

export interface TeamMemberRow {
  membershipId: string;
  userId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

const ROLE_OPTIONS: TeamMemberRow["role"][] = [
  "OWNER",
  "ADMIN",
  "MEMBER",
];

export function TeamMemberList(
  {
    members,
    currentUserId,
    canManage,
  }: {
    members: TeamMemberRow[];
    currentUserId: string;
    canManage: boolean;
  },
) {
  if (members.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        Unable to load team members.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-default)]">
      {members.map(
        (member) => (
          <TeamMemberListItem
            key={member.membershipId}
            member={member}
            // A member can't manage their own row through this UI --
            // self-service role changes/leaving isn't built yet (see
            // 20260828110000_membership_management_policies.sql's
            // header comment), so the controls are simply hidden for
            // your own row rather than sent to an action that would
            // reject them anyway.
            canManage={
              canManage &&
              member.userId !== currentUserId
            }
          />
        ),
      )}
    </ul>
  );
}

function TeamMemberListItem(
  {
    member,
    canManage,
  }: {
    member: TeamMemberRow;
    canManage: boolean;
  },
) {
  const [
    roleState,
    roleFormAction,
    rolePending,
  ] =
    useActionState(
      changeRoleAction,
      initialTeamActionState,
    );

  const [
    removeState,
    removeFormAction,
    removePending,
  ] =
    useActionState(
      removeMemberAction,
      initialTeamActionState,
    );

  return (
    <li className="flex flex-col gap-1.5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {member.email}
          </span>
        </div>

        {canManage ? (
          <div className="flex shrink-0 items-center gap-2">
            <form action={roleFormAction}>
              <input
                type="hidden"
                name="membershipId"
                value={member.membershipId}
              />

              <select
                key={member.role}
                name="role"
                defaultValue={member.role}
                disabled={rolePending}
                onChange={
                  (event) =>
                    event.target.form?.requestSubmit()
                }
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
                aria-label={`Role for ${member.email}`}
              >
                {ROLE_OPTIONS.map(
                  (role) => (
                    <option
                      key={role}
                      value={role}
                    >
                      {role}
                    </option>
                  ),
                )}
              </select>
            </form>

            <form action={removeFormAction}>
              <input
                type="hidden"
                name="membershipId"
                value={member.membershipId}
              />

              <Button
                type="submit"
                variant="ghost"
                size="sm"
                loading={removePending}
                aria-label={`Remove ${member.email}`}
                title={`Remove ${member.email}`}
              >
                <UserMinus
                  className="size-4"
                  aria-hidden="true"
                />
              </Button>
            </form>
          </div>
        ) : (
          <span className="shrink-0 text-sm text-[var(--text-secondary)]">
            {member.role}
          </span>
        )}
      </div>

      <FieldError>
        {roleState.status === "error" ? roleState.message : null}
      </FieldError>

      <FieldError>
        {removeState.status === "error" ? removeState.message : null}
      </FieldError>
    </li>
  );
}
