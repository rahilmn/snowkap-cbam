"use client";

import {
  useActionState,
} from "react";

import {
  RotateCcw,
  UserMinus,
  UserX,
} from "lucide-react";

import {
  ConfirmSubmitButton,
} from "../../components/ui/confirm-submit-button";

import {
  Button,
} from "../../components/ui/button";

import {
  Badge,
} from "../../components/ui/badge";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  formatDate,
} from "../../lib/utils";

import {
  changeRoleAction,
  deactivateMemberAction,
  reactivateMemberAction,
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
  deactivatedAt: string | null;
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
    <>
      {canManage ? (
        <p className="border-b border-[var(--border-default)] p-4 text-xs text-[var(--text-tertiary)]">
          <strong className="font-medium text-[var(--text-secondary)]">
            Deactivate
          </strong>{" "}
          suspends a member's access while keeping their history --
          reactivate them any time.{" "}
          <strong className="font-medium text-[var(--text-secondary)]">
            Remove
          </strong>{" "}
          permanently deletes their membership and cannot be undone --
          use it only to correct a mistaken invite.
        </p>
      ) : null}

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
    </>
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
    deactivateState,
    deactivateFormAction,
    deactivatePending,
  ] =
    useActionState(
      deactivateMemberAction,
      initialTeamActionState,
    );

  const [
    reactivateState,
    reactivateFormAction,
    reactivatePending,
  ] =
    useActionState(
      reactivateMemberAction,
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

  const isDeactivated =
    member.deactivatedAt !== null;

  return (
    <li
      className={
        isDeactivated
          ? "flex flex-col gap-1.5 p-4 opacity-70"
          : "flex flex-col gap-1.5 p-4"
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            {member.email}

            {isDeactivated ? (
              <Badge tone="warning">
                Deactivated
              </Badge>
            ) : null}
          </span>

          {isDeactivated && member.deactivatedAt ? (
            <span className="text-xs text-[var(--text-tertiary)]">
              Since {formatDate(member.deactivatedAt)}
            </span>
          ) : null}
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

            {isDeactivated ? (
              <form action={reactivateFormAction}>
                <input
                  type="hidden"
                  name="membershipId"
                  value={member.membershipId}
                />

                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={reactivatePending}
                  aria-label={`Reactivate ${member.email}`}
                  title="Reactivate: restores this member's access"
                >
                  <RotateCcw
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </form>
            ) : (
              <form action={deactivateFormAction}>
                <input
                  type="hidden"
                  name="membershipId"
                  value={member.membershipId}
                />

                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={deactivatePending}
                  aria-label={`Deactivate ${member.email}`}
                  title="Deactivate: suspends access, keeps history, reversible"
                >
                  <UserX
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </form>
            )}

            <form action={removeFormAction}>
              <input
                type="hidden"
                name="membershipId"
                value={member.membershipId}
              />

              <ConfirmSubmitButton
                variant="destructive"
                size="sm"
                pending={removePending}
                aria-label={`Remove ${member.email}`}
                title="Remove: permanently deletes this membership, cannot be undone"
                confirm={
                  {
                    title: `Remove ${member.email} from this organization?`,
                    description:
                      "This permanently deletes their membership and cannot be undone. To suspend their access while keeping their history, use Deactivate instead.",
                    confirmLabel: "Remove member",
                    variant: "destructive",
                  }
                }
              >
                <UserMinus
                  className="size-4"
                  aria-hidden="true"
                />
              </ConfirmSubmitButton>
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
        {deactivateState.status === "error" ? deactivateState.message : null}
      </FieldError>

      <FieldError>
        {reactivateState.status === "error" ? reactivateState.message : null}
      </FieldError>

      <FieldError>
        {removeState.status === "error" ? removeState.message : null}
      </FieldError>
    </li>
  );
}
