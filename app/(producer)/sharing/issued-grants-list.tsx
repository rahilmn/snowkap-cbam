"use client";

import {
  useActionState,
} from "react";

import {
  X,
} from "lucide-react";

import {
  Button,
} from "../../../components/ui/button";

import {
  Badge,
} from "../../../components/ui/badge";

import {
  revokeSharingGrantAction,
} from "./actions";

import {
  initialSharingScreenActionState,
} from "./action-state";

export interface IssuedGrantRow {
  id: string;
  installationName: string;
  // Identifies the grantee side of the grant. Bootstrap (invited-by-
  // email) grants always carry the email, even after acceptance --
  // that's the only human-readable identity this screen has for the
  // grantee, since the grantor has no RLS visibility into the grantee
  // org's own organizations row (organizations_select_own_org scopes to
  // the caller's own memberships, and the grantee org is -- by
  // definition -- not one of them). Direct grants (invited_email null)
  // show as "Direct grant" for the same reason.
  granteeLabel: string;
  status: "INVITED" | "ACTIVE" | "REVOKED" | "EXPIRED";
  canManage: boolean;
}

const STATUS_TONE: Record<
  IssuedGrantRow["status"],
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  INVITED: "warning",
  ACTIVE: "success",
  REVOKED: "danger",
  EXPIRED: "neutral",
};

export function IssuedGrantsList(
  {
    grants,
  }: {
    grants: IssuedGrantRow[];
  },
) {
  if (grants.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        No data-sharing grants issued yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-default)]">
      {grants.map(
        (grant) => (
          <IssuedGrantListItem
            key={grant.id}
            grant={grant}
          />
        ),
      )}
    </ul>
  );
}

function IssuedGrantListItem(
  {
    grant,
  }: {
    grant: IssuedGrantRow;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      revokeSharingGrantAction,
      initialSharingScreenActionState,
    );

  const canRevoke =
    grant.canManage &&
    (grant.status === "INVITED" || grant.status === "ACTIVE");

  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {grant.installationName}
            </span>

            <Badge tone={STATUS_TONE[grant.status]}>
              {grant.status}
            </Badge>
          </div>

          <span className="text-xs text-[var(--text-secondary)]">
            {grant.granteeLabel}
          </span>
        </div>

        {canRevoke ? (
          <form action={formAction}>
            <input
              type="hidden"
              name="grantId"
              value={grant.id}
            />

            <Button
              type="submit"
              variant="ghost"
              size="sm"
              loading={pending}
              aria-label={`Revoke access for ${grant.installationName}`}
              title={`Revoke access for ${grant.installationName}`}
            >
              <X
                className="size-4"
                aria-hidden="true"
              />
            </Button>
          </form>
        ) : null}
      </div>

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
