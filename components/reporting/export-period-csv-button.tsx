"use client";

import {
  Download,
} from "lucide-react";

import {
  Button,
} from "../ui/button";

import {
  buildPeriodExportCsv,
} from "./period-export-csv";

import type {
  PeriodExportRow,
} from "../../src/application/reporting/build-period-export-rows";

/**
 * Client-side CSV export for the period the Reports page already
 * fetched and passed down -- same Blob + `URL.createObjectURL` +
 * synthetic-anchor-click pattern as
 * components/audit/export-audit-csv-button.tsx (this task's own
 * instruction: "mirroring... its exact Blob+URL.createObjectURL+
 * synthetic-anchor pattern"), including the identical revoke-after-click
 * cleanup so the Blob doesn't linger in memory for the rest of the
 * page's lifetime.
 */
export function ExportPeriodCsvButton(
  {
    rows,
    filename,
  }: {
    rows: PeriodExportRow[];
    filename: string;
  },
) {
  function handleExport() {
    const csv =
      buildPeriodExportCsv(
        rows,
      );

    const blob =
      new Blob(
        [csv],
        { type: "text/csv;charset=utf-8;" },
      );

    const url =
      URL.createObjectURL(
        blob,
      );

    const anchor =
      document.createElement(
        "a",
      );

    anchor.href =
      url;

    anchor.download =
      filename;

    document.body.appendChild(
      anchor,
    );

    anchor.click();

    document.body.removeChild(
      anchor,
    );

    URL.revokeObjectURL(
      url,
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="md"
      disabled={rows.length === 0}
      onClick={handleExport}
    >
      <Download
        className="size-4"
        aria-hidden="true"
      />

      Export CSV
    </Button>
  );
}
