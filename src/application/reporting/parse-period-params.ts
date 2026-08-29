import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

// Mirrors Next's own `searchParams` value shape (a repeated query key
// decodes to a string[], per parse-audit-filters.ts's own
// AuditFilterParams doc comment) so this accepts a page's raw
// `searchParams` object directly; app/api/reports/export/route.ts (a
// route handler, not a Server Component page) builds this same shape
// from `URL.searchParams.get(...)` instead, so the page and the export
// route parse the identical `?year=&quarter=` contract through exactly
// one function rather than two independently-maintained copies that
// could drift (see build-period-export-rows.ts's own doc comment on why
// the CSV and XLSX exports share one row-building function for the
// identical reason).
export interface PeriodQueryParams {
  year?: string | string[];
  quarter?: string | string[];
}

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value)
    ? value[0]
    : value;
}

const YEAR_PATTERN =
  /^\d{4}$/;

/**
 * Parses the Reports screen's two URL params (master plan §27 screen 21:
 * "?year=2026 or ?year=2026&quarter=3") into a ReportingPeriod, or
 * `null` for anything not cleanly parseable. Deliberately permissive
 * about "no `year` at all" (a bare `/reports` visit, or the very first
 * load before a user has picked anything) -- that returns `null`, not a
 * thrown error, so the page can render its period picker instead of
 * crashing (this task's own "an invalid/missing period should show a
 * clear picker/empty state, not crash").
 *
 * Unlike parseAuditFilterParams (parse-audit-filters.ts), which drops an
 * unparseable single field and silently proceeds without it, an invalid
 * `quarter` here returns `null` for the WHOLE period rather than
 * falling back to ANNUAL: a report is queried against one specific
 * period, and silently substituting ANNUAL for a URL that named a
 * quarter would show the caller a DIFFERENT period's data than the one
 * their link actually asked for -- the same "surface, don't guess"
 * posture CLAUDE.md's protected-zone rules apply to ambiguous
 * regulatory data, applied here to which period's figures are on
 * screen.
 */
export function parsePeriodParams(
  params: PeriodQueryParams,
): ReportingPeriod | null {
  const yearRaw =
    firstValue(
      params.year,
    )?.trim();

  if (!yearRaw || !YEAR_PATTERN.test(yearRaw)) {
    return null;
  }

  const year =
    Number(
      yearRaw,
    );

  const quarterRaw =
    firstValue(
      params.quarter,
    )?.trim();

  if (!quarterRaw) {
    return {
      kind: "ANNUAL",
      year,
    };
  }

  const quarter =
    Number(
      quarterRaw,
    );

  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    return null;
  }

  return {
    kind: "QUARTERLY",
    year,
    quarter: quarter as 1 | 2 | 3 | 4,
  };
}
