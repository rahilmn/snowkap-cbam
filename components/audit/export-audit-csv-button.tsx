"use client";

import {
  Download,
} from "lucide-react";

import {
  Button,
} from "../ui/button";

import {
  buildAuditEventsCsv,
} from "./audit-event-csv";

import type {
  AuditEventRowView,
} from "./audit-event-view";

/**
 * Client-side CSV export for the currently-filtered rows a server page
 * already fetched and passed down -- deliberately not a new
 * `app/api/**` download route. Master plan §21 already earmarks a
 * distinct "audit export" surface for the full-history/async case
 * (see DEFAULT_LIST_LIMIT's own comment in list-audit-events.ts); this
 * button exports exactly the bounded, already-in-memory rows the table
 * is showing, so a route handler with its own re-query, auth check,
 * and streaming concerns would be solving a problem this screen
 * doesn't have yet.
 *
 * Blob + `URL.createObjectURL` + a synthetic anchor click, no
 * server round-trip -- the standard client-side-download pattern;
 * revokes the object URL immediately after the click so the Blob
 * doesn't linger in memory for the rest of the page's lifetime.
 */
export function ExportAuditCsvButton(
  {
    rows,
    filename,
  }: {
    rows: AuditEventRowView[];
    filename: string;
  },
) {
  function handleExport() {
    const csv =
      buildAuditEventsCsv(
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
