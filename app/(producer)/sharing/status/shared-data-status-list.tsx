import {
  Badge,
} from "../../../../components/ui/badge";

import {
  Card,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";

export interface SharedDataStatusEventView {
  id: string;
  occurredAt: string;
  // "DETERMINED" | "REDETERMINED" | null (a malformed/unexpected
  // payload -- see list-shared-data-status.ts's own toConsumptionEvent)
  // rendered honestly rather than guessed.
  determinationKind: string | null;
}

export interface SharedDataStatusRowView {
  id: string;
  installationName: string;
  granteeLabel: string;
  status: "INVITED" | "ACTIVE" | "REVOKED" | "EXPIRED";
  events: SharedDataStatusEventView[];
}

const STATUS_TONE: Record<
  SharedDataStatusRowView["status"],
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  INVITED: "warning",
  ACTIVE: "success",
  REVOKED: "danger",
  EXPIRED: "neutral",
};

const DETERMINATION_KIND_LABEL: Record<string, string> = {
  DETERMINED: "Determined",
  REDETERMINED: "Redetermined",
};

function formatTimestamp(
  iso: string,
): string {
  return new Date(
    iso,
  ).toLocaleString(
    "en-GB",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

export function SharedDataStatusList(
  {
    rows,
  }: {
    rows: SharedDataStatusRowView[];
  },
) {
  if (rows.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        No data-sharing grants issued yet -- issue one from the Sharing
        screen to see who holds access here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map(
        (row) => (
          <SharedDataStatusCard
            key={row.id}
            row={row}
          />
        ),
      )}
    </ul>
  );
}

function SharedDataStatusCard(
  {
    row,
  }: {
    row: SharedDataStatusRowView;
  },
) {
  const lastUsedAt =
    row.events[0]?.occurredAt ?? null;

  return (
    <li>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>
                {row.installationName}
              </CardTitle>

              <Badge tone={STATUS_TONE[row.status]}>
                {row.status}
              </Badge>
            </div>

            <span className="text-xs text-[var(--text-secondary)]">
              Shared with {row.granteeLabel}
            </span>
          </div>

          <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
            {lastUsedAt
              ? `Last used ${formatTimestamp(lastUsedAt)}`
              : "Not yet used"}
          </span>
        </CardHeader>

        <div className="p-4">
          {row.events.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              No consumption events recorded -- the grantee has not yet
              determined a shipment line from this data.
            </p>
          ) : (
            <>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                Consumption history ({row.events.length})
              </p>

              <p className="mb-2 text-xs text-[var(--text-tertiary)]">
                Reported by the grantee at determination time -- a record of
                activity, not independently verified proof of exactly what
                was read.
              </p>

              <ul className="flex flex-col divide-y divide-[var(--border-default)]">
                {row.events.map(
                  (event) => (
                    <li
                      key={event.id}
                      className="flex items-center justify-between gap-4 py-1.5 text-sm"
                    >
                      <span className="text-[var(--text-primary)]">
                        {event.determinationKind
                          ? DETERMINATION_KIND_LABEL[event.determinationKind] ??
                            event.determinationKind
                          : "Determination"}
                      </span>

                      <span className="text-[var(--text-secondary)]">
                        {formatTimestamp(event.occurredAt)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
        </div>
      </Card>
    </li>
  );
}
