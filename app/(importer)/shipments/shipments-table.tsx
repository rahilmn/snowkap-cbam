"use client";

import Link from "next/link";

import {
  DataTable,
  type DataTableColumn,
} from "../../../components/ui/data-table";

import {
  StatusBadge,
} from "../../../components/ui/status-badge";

import {
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

import {
  shipmentStatusKey,
} from "../../../src/domain/status-vocabulary";

import type {
  Shipment,
} from "../../../src/domain/shipments/types";

/**
 * S3, v2.1.1 DataTable foundation. A client component, deliberately
 * separate from the (server) page component -- column definitions
 * carry render/sortValue FUNCTIONS, and a function cannot cross the
 * Server->Client Component prop boundary (React would throw "Functions
 * cannot be passed directly to Client Components"). `shipments` itself
 * (plain data) crosses the boundary fine; only the closures defining
 * how to render/sort each column must be constructed on the client
 * side of that boundary.
 */
const SHIPMENT_COLUMNS: DataTableColumn<Shipment>[] =
  [
    {
      key: "reference",
      header: "Reference",
      sortValue: (shipment) => shipment.reference,
      render: (shipment) => (
        // min-h-11 (44px): on the mobile card fallback this IS the
        // card's title AND its only interactive control (data-table.tsx
        // renders it bare, with no padding/min-height of its own) --
        // found under-sized in a fresh S3 review (N4). inline-flex
        // rather than block so it doesn't force the desktop <td> onto
        // its own line.
        <Link
          href={`/shipments/${shipment.id}`}
          className="inline-flex min-h-11 items-center font-medium text-[var(--text-primary)] hover:underline"
        >
          {shipment.reference}
        </Link>
      ),
    },
    {
      key: "release_date",
      header: "Release date",
      className: "tabular-nums text-[var(--text-secondary)]",
      sortValue: (shipment) => shipment.release_date,
      render: (shipment) => shipment.release_date,
    },
    {
      key: "reporting_period",
      header: "Reporting period",
      className: "tabular-nums text-[var(--text-secondary)]",
      sortValue: (shipment) =>
        shipment.reporting_period.year * 10
          + (shipment.reporting_period.kind === "QUARTERLY" ? shipment.reporting_period.quarter : 0),
      render: (shipment) => formatReportingPeriod(shipment.reporting_period),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (shipment) => shipment.status,
      render: (shipment) => (
        <StatusBadge
          statusKey={shipmentStatusKey(shipment.status)}
        />
      ),
    },
  ];

export function ShipmentsTable(
  {
    shipments,
  }: {
    shipments: Shipment[];
  },
) {
  return (
    <DataTable
      columns={SHIPMENT_COLUMNS}
      rows={shipments}
      getRowKey={(shipment) => shipment.id}
      caption="Shipments"
      emptyMessage="No shipments yet. Create your first shipment to begin classifying goods and resolving embedded emissions."
    />
  );
}
