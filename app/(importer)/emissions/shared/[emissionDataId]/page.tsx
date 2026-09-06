import Link from "next/link";

import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../../../components/shell/app-shell";

import {
  Card,
  CardHeader,
  CardTitle,
} from "../../../../../components/ui/card";

import {
  Badge,
} from "../../../../../components/ui/badge";

import {
  StatusBadge,
} from "../../../../../components/ui/status-badge";

import {
  methodologyKey,
  reviewBadgeFor,
  verifierReportBadgeFor,
} from "../../../../../src/domain/status-vocabulary";

import {
  getServerSupabaseClient,
} from "../../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../../components/shell/get-preferred-org-id";

import {
  getBuyerView,
  type BuyerViewData,
} from "../../../../../src/application/emissions/get-buyer-view";

import {
  formatReportingPeriod,
} from "../../../../../src/domain/shared/reporting-period";

/**
 * S4 (producer/trust/sharing), v2.1.1 §19: "Buyer view & readiness" --
 * factual emissions data, provenance, evidence/review state, and a
 * completeness/readiness checklist for one record shared with (or
 * owned by) the caller's org. Explicitly NOT a supplier score, green
 * score, ranking, or benchmark (§19's own list of what this is not) --
 * every fact rendered here is either a direct field off the record or
 * a badge this codebase's status vocabulary already defines elsewhere;
 * nothing new is computed or scored.
 *
 * Reachable from the "Shared-in producer data" table on /emissions
 * (installation name links here) -- not its own top-level nav item,
 * since the S4 INSPECT pass found no existing importer-side sharing/
 * readiness nav slot and this is a detail view of that same table, not
 * a distinct product area.
 */
export default async function BuyerViewPage(
  {
    params,
  }: {
    params: Promise<{ emissionDataId: string }>;
  },
) {
  const { emissionDataId } =
    await params;

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

  const buyerView =
    await getBuyerView(
      supabase,
      orgSummary.context.org_id,
      emissionDataId as never,
    );

  if (!buyerView) {
    redirect(
      "/emissions",
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Emissions", href: "/emissions" },
        { label: "Buyer view & readiness" },
      ]}
    >
      <div className="mb-4 flex max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Buyer view & readiness
        </h1>

        <p className="text-sm text-[var(--text-secondary)]">
          What this organization has shared with you, where it came from,
          and whether it is complete enough to rely on -- facts and
          provenance only, never a score or ranking.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-4">
        <FactsCard
          buyerView={buyerView}
        />

        <ProvenanceCard
          buyerView={buyerView}
        />

        <DossierCard
          buyerView={buyerView}
        />

        <ReadinessCard
          buyerView={buyerView}
        />

        <VerificationSupportCard />
      </div>
    </AppShell>
  );
}

function FactsCard(
  {
    buyerView,
  }: {
    buyerView: BuyerViewData;
  },
) {
  const { option } =
    buyerView;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {option.installation_name}
        </CardTitle>
      </CardHeader>

      <dl className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[var(--text-tertiary)]">
            Country
          </dt>

          <dd className="text-[var(--text-primary)]">
            {option.installation_country}
          </dd>
        </div>

        <div>
          <dt className="text-[var(--text-tertiary)]">
            Reporting period
          </dt>

          <dd className="tabular-nums text-[var(--text-primary)]">
            {formatReportingPeriod(
              option.reporting_period,
            )}
          </dd>
        </div>

        <div>
          <dt className="text-[var(--text-tertiary)]">
            Methodology
          </dt>

          <dd>
            <StatusBadge
              statusKey={methodologyKey(option.methodology)}
            />
          </dd>
        </div>

        <div>
          <dt className="text-[var(--text-tertiary)]">
            Direct specific emissions
          </dt>

          <dd className="font-mono tabular-nums text-[var(--text-primary)]">
            {option.direct_specific} {option.emission_unit}
          </dd>
        </div>

        <div>
          <dt className="text-[var(--text-tertiary)]">
            Indirect specific emissions
          </dt>

          <dd className="font-mono tabular-nums text-[var(--text-primary)]">
            {option.indirect_specific} {option.emission_unit}
          </dd>
        </div>

        {option.provenance === "SHARED" ? (
          <div>
            <dt className="text-[var(--text-tertiary)]">
              Shared by
            </dt>

            <dd>
              <Badge tone="brand">
                {option.grantor_organization_name}
              </Badge>
            </dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}

function ProvenanceCard(
  {
    buyerView,
  }: {
    buyerView: BuyerViewData;
  },
) {
  const { option } =
    buyerView;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Provenance
        </CardTitle>
      </CardHeader>

      <dl className="flex flex-col gap-3 p-4 text-sm">
        <div>
          <dt className="text-[var(--text-tertiary)]">
            Source
          </dt>

          <dd className="text-[var(--text-primary)]">
            {option.record_provenance === "IMPORTER_ENTERED"
              ? "Importer-entered (from operator information)"
              : "Operator-provided"}
          </dd>
        </div>

        <div>
          <dt className="text-[var(--text-tertiary)]">
            Review
          </dt>

          <dd>
            {/* Every option listAvailableActualEmissionData returns is
                already VERIFIED (its own visibility rule) -- reviewBadgeFor
                still takes it explicitly rather than being hardcoded, so a
                future relaxation of that rule cannot silently mislabel an
                unreviewed record as reviewed here. */}
            <StatusBadge
              statusKey={reviewBadgeFor("VERIFIED", option.record_provenance)}
            />
          </dd>
        </div>

        <div>
          <dt className="text-[var(--text-tertiary)]">
            Verifier report
          </dt>

          <dd>
            <StatusBadge
              statusKey={verifierReportBadgeFor(buyerView.declarationContext?.verifier_report_declared ?? false)}
            />

            {buyerView.declarationContext?.verifier_report_description ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {buyerView.declarationContext.verifier_report_description}
              </p>
            ) : null}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function DossierCard(
  {
    buyerView,
  }: {
    buyerView: BuyerViewData;
  },
) {
  const { declarationContext, precursors } =
    buyerView;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Dossier context
        </CardTitle>
      </CardHeader>

      <div className="flex flex-col gap-3 p-4 text-sm">
        {declarationContext?.production_process_description ? (
          <div>
            <p className="text-[var(--text-tertiary)]">
              Production process
            </p>

            <p className="text-[var(--text-primary)]">
              {declarationContext.production_process_description}
            </p>
          </div>
        ) : (
          <p className="text-[var(--text-secondary)]">
            No production process description was provided.
          </p>
        )}

        <div>
          <p className="mb-1.5 text-[var(--text-tertiary)]">
            Precursor materials
          </p>

          {precursors.length === 0 ? (
            <p className="text-[var(--text-secondary)]">
              {declarationContext?.uses_purchased_precursors
                ? "The operator indicated purchased precursors are used, but did not list any."
                : "No CBAM-covered precursor materials were declared."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {precursors.map(
                (precursor) => (
                  <li
                    key={precursor.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-2 text-xs"
                  >
                    <span className="font-medium text-[var(--text-primary)]">
                      {precursor.material_description}
                      {precursor.cn_code ? ` (${precursor.cn_code})` : ""}
                    </span>

                    <p className="mt-0.5 text-[var(--text-secondary)]">
                      {precursor.direct_specific !== null || precursor.indirect_specific !== null
                        ? `Direct ${precursor.direct_specific ?? "--"} / Indirect ${precursor.indirect_specific ?? "--"} ${precursor.emission_unit ?? ""}`
                        : "No figures provided"}
                      {" -- "}
                      {precursor.provenance === "ACTUAL_WITH_DECLARED_REPORT"
                        ? "Actual value -- verifier report declared by operator (not validated by Snowkap)"
                        : precursor.provenance === "ACTUAL_NO_DECLARED_REPORT"
                          ? "Actual value -- no verifier report declared"
                          : "Not known"}
                    </p>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

interface ReadinessCheck {
  label: string;
  met: boolean;
  notApplicable?: boolean;
}

function readinessChecks(
  buyerView: BuyerViewData,
): ReadinessCheck[] {
  const { option, declarationContext, precursors, evidenceFileCount } =
    buyerView;

  const checks: ReadinessCheck[] =
    [
      {
        label: "Reviewed internally by the recording organization",
        met: true,
      },
      {
        label: "Supporting evidence attached",
        met: evidenceFileCount > 0,
      },
      {
        label: "Production process described",
        met: Boolean(declarationContext?.production_process_description),
      },
    ];

  if (declarationContext?.uses_purchased_precursors) {
    checks.push(
      {
        label: "Precursor materials listed",
        met: precursors.length > 0,
      },
    );
  }

  if (option.record_provenance === "IMPORTER_ENTERED") {
    checks.push(
      {
        label: "Operator-provided source (recorded by the operator itself, not transcribed)",
        met: false,
      },
    );
  }

  return checks;
}

function ReadinessCard(
  {
    buyerView,
  }: {
    buyerView: BuyerViewData;
  },
) {
  const checks =
    readinessChecks(
      buyerView,
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Readiness checklist
        </CardTitle>
      </CardHeader>

      <ul className="flex flex-col gap-2 p-4 text-sm">
        {checks.map(
          (check) => (
            <li
              key={check.label}
              className="flex items-center gap-2"
            >
              <Badge tone={check.met ? "success" : "warning"}>
                {check.met ? "Yes" : "No"}
              </Badge>

              <span className="text-[var(--text-primary)]">
                {check.label}
              </span>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

function VerificationSupportCard() {
  return (
    <Card className="p-4">
      <p className="text-sm text-[var(--text-primary)]">
        Looking for accredited verification of this data?
      </p>

      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Snowkap does not perform accredited verification.
      </p>

      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Contact an independent verification body for that.
      </p>

      <Link
        href="https://snowkap.com/contact-us/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-sm font-medium text-[var(--accent-brand)] hover:underline"
      >
        Request verification support
      </Link>
    </Card>
  );
}
