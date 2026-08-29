import Form from "next/form";

import {
  Input,
} from "../ui/input";

import {
  Label,
} from "../ui/label";

import {
  Button,
} from "../ui/button";

const REPORTS_BASE_PATH =
  "/reports";

const QUARTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Annual (no quarter)" },
  { value: "1", label: "Q1" },
  { value: "2", label: "Q2" },
  { value: "3", label: "Q3" },
  { value: "4", label: "Q4" },
];

/**
 * The Reports screen's period selector -- a plain GET `<Form>`
 * (next/form, not client `useState`) so the selected period lives
 * entirely in the URL, matching AuditFilterBar's own "URL state for
 * filters" convention (audit-filter-bar.tsx's doc comment) for the same
 * reason: a report for a specific period is a link a user can bookmark
 * or hand to a teammate, and the export route
 * (app/api/reports/export/route.ts) reads the identical `year`/`quarter`
 * params this form submits.
 *
 * `year` is a plain text input (not `type="number"`) with an explicit
 * 4-digit pattern -- `type="number"` lets a user's browser silently
 * strip a leading zero or accept scientific notation ("1e3"), neither
 * of which parsePeriodParams's own YEAR_PATTERN would accept anyway;
 * matching the regex in the input's own `pattern` attribute gives an
 * inline validation message before submit, rather than a silent
 * "no results" after one.
 */
export function PeriodPicker(
  {
    year,
    quarter,
  }: {
    year: string;
    quarter: string;
  },
) {
  return (
    <Form
      action={REPORTS_BASE_PATH}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="period-picker-year">
          Year
        </Label>

        <Input
          id="period-picker-year"
          name="year"
          defaultValue={year}
          placeholder="2026"
          pattern="\d{4}"
          maxLength={4}
          required
          className="w-24"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="period-picker-quarter">
          Quarter
        </Label>

        <select
          id="period-picker-quarter"
          name="quarter"
          defaultValue={quarter}
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)]"
        >
          {QUARTER_OPTIONS.map(
            (option) => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ),
          )}
        </select>
      </div>

      <Button type="submit">
        View report
      </Button>
    </Form>
  );
}
