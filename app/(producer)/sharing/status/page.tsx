import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../../components/shell/app-shell";

import {
  getServerSupabaseClient,
} from "../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../components/shell/get-preferred-org-id";

import {
  listSharedDataStatus,
} from "../../../../src/application/sharing/list-shared-data-status";

import {
  SharedDataStatusList,
  type SharedDataStatusRowView,
} from "./shared-data-status-list";

import {
  effectiveSharingGrantStatus,
} from "../../../../src/domain/sharing/effective-grant-status";

/**
 * Master plan §27 screen 32 ("Shared-data status" -- "transparency; who
 * sees what, consumption events"). A separate screen from
 * app/(producer)/sharing/page.tsx (screen 31, "Sharing" -- the issue/
 * accept-invite flow) rather than an extension of it: the master plan
 * itself lists these as two distinct screens with distinct purposes
 * (31 = manage grants; 32 = read the resulting transparency picture),
 * and 32's own content -- per-grant consumption-event history -- is
 * additive information the existing grants list has no room for
 * without either cluttering the management flow or duplicating the
 * grants table wholesale. This screen reuses listSharedDataStatus
 * (src/application/sharing/list-shared-data-status.ts) rather than
 * re-deriving its own grants query, so the two screens can never
 * disagree about which grants exist -- only about how much detail each
 * one shows.
 *
 * Read-only: MEMBER+ per §27 ("32 ... read MEMBER+"), no admin gate and
 * no mutations here at all -- revoke/issue stay on /sharing.
 */
export default async function SharedDataStatusPage() {
  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    redirect(
      "/onboarding",
    );
  }

  const statusRows =
    await listSharedDataStatus(
      supabase,
      orgSummary.context.org_id,
    );

  // 2026-09-07 (S5 review round 4, finding S5R4-VOCAB-1). One clock
  // reading for the whole page -- see effective-grant-status.ts's own
  // doc comment for why nothing ever flips a time-lapsed ACTIVE grant's
  // stored `status` to EXPIRED, so a raw read here would show "Active"
  // for a grant whose real access has already lapsed.
  const now =
    new Date();

  const rows: SharedDataStatusRowView[] =
    statusRows.map(
      (row) => (
        {
          id: row.grant.id,
          installationName: row.installationName,
          granteeLabel: row.granteeLabel,
          status: effectiveSharingGrantStatus(
            row.grant.status,
            row.grant.expires_at,
            now,
          ),
          events: row.consumptionEvents.map(
            (event) => (
              {
                id: event.id,
                occurredAt: event.occurredAt,
                determinationKind: event.determinationKind,
              }
            ),
          ),
          eventsUnavailable: row.consumptionEventsUnavailable,
        }
      ),
    );

  return (
    <AppShell
      experience="producer"
      breadcrumbs={[
        { label: "Sharing", href: "/sharing" },
        { label: "Shared-data status" },
      ]}
    >
      <div className="mb-4 flex max-w-2xl flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Shared-data status
        </h1>

        <p className="text-sm text-[var(--text-secondary)]">
          Every grant your organization has issued and every time that
          data has actually been read to determine a shipment line. The
          grantee&apos;s name keeps showing after a grant is revoked or
          expires -- consumption history is a record of what already
          happened, and revoking a grant does not erase who it was
          issued to.
        </p>
      </div>

      <div className="max-w-2xl">
        <SharedDataStatusList
          rows={rows}
        />
      </div>
    </AppShell>
  );
}
