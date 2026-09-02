import {
  Badge,
} from "../../../../components/ui/badge";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import type {
  ActualEmissionDataOptionForLine,
} from "../../../../src/application/emissions/mark-actual-options-for-line";

/**
 * What a chosen dataset actually says, shown before it is used.
 *
 * The picker was a bare dropdown and a ghost "Use this data" button:
 * the figures the importer was about to freeze into a declaration were
 * visible only as a truncated string inside a select option, and
 * nothing was shown between choosing and committing. This renders the
 * selection in full so the decision is made with the numbers in view.
 *
 * `declaredOriginCountry` is the LINE's declared origin, shown beside
 * the installation's own country. The ACTUAL path never reads origin --
 * correct, and deliberate: the v10 validator's ACTUAL branch does not
 * consult p_origin_country, and actual emissions are a property of the
 * installation, not of a country table. But nothing anywhere checks
 * that an installation in country X plausibly backs a line declaring
 * origin Y. Rather than invent a rule about that (no rule in
 * docs/regulatory/CALCULATION_RULE_REGISTER.md answers it, and
 * inventing one is forbidden), both are surfaced and the human judges.
 * The open question is recorded in the release report.
 */
export function ActualDataPreview(
  {
    option,
    declaredOriginCountry,
  }: {
    option: ActualEmissionDataOptionForLine;
    declaredOriginCountry: string;
  },
) {
  const originsDiffer =
    option.installation_country !== declaredOriginCountry;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-3">
      <h4 className="text-xs font-medium text-[var(--text-secondary)]">
        Selected dataset
      </h4>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--text-tertiary)]">
          Installation
        </dt>

        <dd className="text-[var(--text-primary)]">
          {option.installation_name} ({option.installation_country})
        </dd>

        <dt className="text-[var(--text-tertiary)]">
          Declared origin of this line
        </dt>

        <dd className="text-[var(--text-primary)]">
          {declaredOriginCountry}

          {originsDiffer ? (
            <span className="ml-1.5 text-[var(--text-tertiary)]">
              differs from the installation&apos;s country
            </span>
          ) : null}
        </dd>

        <dt className="text-[var(--text-tertiary)]">
          Reporting period
        </dt>

        <dd className="text-[var(--text-primary)]">
          {formatReportingPeriod(option.reporting_period)}
        </dd>

        <dt className="text-[var(--text-tertiary)]">
          Direct
        </dt>

        <dd className="font-mono text-[var(--text-primary)]">
          {option.direct_specific} {option.emission_unit}
        </dd>

        <dt className="text-[var(--text-tertiary)]">
          Indirect
        </dt>

        <dd className="font-mono text-[var(--text-primary)]">
          {option.indirect_specific} {option.emission_unit}
        </dd>

        <dt className="text-[var(--text-tertiary)]">
          Methodology
        </dt>

        <dd className="text-[var(--text-primary)]">
          {option.methodology.replace(/_/g, " ")}
        </dd>

        <dt className="text-[var(--text-tertiary)]">
          Source
        </dt>

        <dd className="text-[var(--text-primary)]">
          {option.provenance === "SHARED"
            ? `Shared by ${option.grantor_organization_name}`
            : "Your organization's own data"}
        </dd>
      </dl>

      <div>
        <Badge tone="success">
          Verified
        </Badge>
      </div>
    </div>
  );
}
