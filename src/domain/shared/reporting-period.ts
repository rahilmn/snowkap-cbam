import type {
  Brand,
} from "./ids";

export type IsoDate =
  Brand<string, "IsoDate">;

export type IsoTimestamp =
  Brand<string, "IsoTimestamp">;

export type ParseIsoDateResult =
  | { status: "OK"; value: IsoDate }
  | { status: "INVALID" };

const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates a strict YYYY-MM-DD calendar date. Rejects malformed strings
 * and calendar-impossible dates (e.g. 2026-02-30) — domain data never
 * carries a Date object (see the shared-kernel numeric/date conventions
 * in docs/architecture/ARCHITECTURE.md), so this is the one place that
 * knows how to validate the shape.
 */
export function parseIsoDate(
  raw: string,
): ParseIsoDateResult {
  const match =
    ISO_DATE_PATTERN.exec(
      raw,
    );

  if (!match) {
    return {
      status: "INVALID",
    };
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
  ] = match;

  const year =
    Number(
      yearText,
    );

  const month =
    Number(
      monthText,
    );

  const day =
    Number(
      dayText,
    );

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!roundTrips) {
    return {
      status: "INVALID",
    };
  }

  return {
    status: "OK",
    value: raw as IsoDate,
  };
}

/**
 * The CBAM definitive regime (annual reporting) begins with reporting
 * year 2026; release dates before that fall under the transitional
 * regime (quarterly reporting). See docs/architecture/REGULATORY_RESOLUTION_RULES.md
 * for the source authority (Commission Implementing Regulation (EU)
 * 2026/1740) that this project's regulatory data is drawn from.
 */
const DEFINITIVE_REGIME_START_YEAR = 2026;

export type ReportingPeriod =
  | { kind: "ANNUAL"; year: number }
  | { kind: "QUARTERLY"; year: number; quarter: 1 | 2 | 3 | 4 };

/**
 * Derives the applicable ReportingPeriod from a shipment's release date.
 * This is a pure classification, not a policy choice — which regime
 * applies is fixed by the release date alone.
 */
export function reportingPeriodForReleaseDate(
  releaseDate: IsoDate,
): ReportingPeriod {
  const [
    yearText,
    monthText,
  ] =
    releaseDate.split(
      "-",
    );

  const year =
    Number(
      yearText,
    );

  const month =
    Number(
      monthText,
    );

  if (year >= DEFINITIVE_REGIME_START_YEAR) {
    return {
      kind: "ANNUAL",
      year,
    };
  }

  const quarter =
    (Math.floor(
      (month - 1) / 3,
    ) + 1) as 1 | 2 | 3 | 4;

  return {
    kind: "QUARTERLY",
    year,
    quarter,
  };
}

/**
 * A stable, lexically-sortable string form: "2026" or "2025-Q4". Useful
 * as a display label and as a query/sort key.
 */
export function formatReportingPeriod(
  period: ReportingPeriod,
): string {
  if (period.kind === "ANNUAL") {
    return String(
      period.year,
    );
  }

  return `${period.year}-Q${period.quarter}`;
}
