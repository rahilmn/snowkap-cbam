import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../../components/shell/app-shell";

import {
  Card,
} from "../../../../components/ui/card";

import {
  StatusBadge,
} from "../../../../components/ui/status-badge";

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
  getShipmentDetail,
} from "../../../../src/application/shipments/get-shipment-detail";

import {
  getLatestCalculationsByShipment,
} from "../../../../src/application/calculations/get-latest-calculations";

import {
  getShipmentEmissionsTotal,
} from "../../../../src/application/calculations/get-shipment-emissions-total";

import {
  determinationDatasetIsCurrent,
} from "../../../../src/domain/emissions/determination-dataset-currency";

import {
  markActualOptionsForLine,
  type ActualEmissionDataOptionForLine,
} from "../../../../src/application/emissions/mark-actual-options-for-line";

import {
  listAvailableActualEmissionData,
} from "../../../../src/application/emissions/list-available-actual-data";

import {
  checkActualDeterminationStalenessByShipment,
} from "../../../../src/application/emissions/check-actual-determination-staleness";

import {
  getDefaultReferenceForLine,
} from "../../../../src/application/emissions/get-default-reference-for-line";

import type {
  DefaultReferenceDisplay,
} from "../../../../src/domain/emissions/default-reference";

import {
  getRegulatoryCountryMapper,
  getRegulatoryRepository,
} from "../../../../src/infrastructure/regulatory/get-regulatory-repository";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import {
  AddLineWizard,
} from "./add-line-wizard";

import {
  LinesTable,
} from "./lines-table";

import {
  TransitionActions,
} from "./transition-actions";

import {
  shipmentStatusKey,
} from "../../../../src/domain/status-vocabulary";

export default async function ShipmentDetailPage(
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } =
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

  const shipment =
    await getShipmentDetail(
      supabase,
      orgSummary.context.org_id,
      id as never,
    );

  if (!shipment) {
    redirect(
      "/shipments",
    );
  }

  const latestCalculations =
    await getLatestCalculationsByShipment(
      supabase,
      orgSummary.context.org_id,
      shipment.id,
    );

  // 2026-09-06 (S5 review remediation, finding A4). Same "fetched once
  // per call, not per line" shape compute-declaration-draft-facts.ts's
  // own identical fetch uses -- regulatory_datasets carries no org
  // scoping.
  const { data: activeDatasetRows, error: activeDatasetError } =
    await supabase
      .from("regulatory_datasets")
      .select(
        "id",
      )
      .eq("status", "ACTIVE");

  if (activeDatasetError) {
    throw new Error(
      `shipments: active regulatory datasets fetch failed (${activeDatasetError.message}).`,
    );
  }

  const activeDatasetIds =
    new Set(
      ((activeDatasetRows ?? []) as { id: string }[]).map(
        (row) => row.id,
      ),
    );

  // 2026-09-07 (S5 review round 10, finding S5R10-NUM-B1). The engine-
  // version sibling of the activeDatasetIds fetch just above -- same
  // "fetched once per call, not per line" shape, same reason
  // (current_engine_version() carries no org scoping; it is one shared
  // fact). public.current_engine_version() (20260904110000) is the
  // sanctioned read-only accessor for exactly this comparison.
  const { data: currentEngineVersion, error: currentEngineVersionError } =
    await supabase
      .rpc(
        "current_engine_version",
      );

  if (currentEngineVersionError) {
    throw new Error(
      `shipments: current engine version fetch failed (${currentEngineVersionError.message}).`,
    );
  }

  // 2026-09-06 (S5 review remediation, finding A4). Computed server-side
  // -- the client never receives activeDatasetIds itself, only the
  // resulting per-line boolean, matching this page's own established
  // "server decides, only the result is sent" convention.
  const datasetSupersededByLineId: Record<string, boolean> =
    Object.fromEntries(
      shipment.lines.map(
        (line) => (
          [
            line.id,
            !determinationDatasetIsCurrent(
              line.emission_determination,
              activeDatasetIds,
            ),
          ]
        ),
      ),
    );

  // S3 (v2.1.1 §6), prominent result: the one number a user actually
  // came here for. See get-shipment-emissions-total.ts's own doc
  // comment for why a STALE calculation (a line re-determined without
  // being recalculated) must never contribute its superseded figure
  // here -- fixed 2026-09-06 after a fresh independent review (B1).
  const emissionsTotal =
    getShipmentEmissionsTotal(
      shipment.lines,
      latestCalculations,
      activeDatasetIds,
      currentEngineVersion as string,
    );

  // Per-line, not org-wide -- listAvailableActualEmissionData now filters
  // by cn_scope against a line's own declared cn_code (see its own doc
  // comment). Fetched once per DISTINCT cn_code among this shipment's
  // lines (not once per line) so two lines declaring the same code don't
  // trigger redundant, identical queries, then fanned back out to every
  // line that declared that code.
  const distinctCnCodes =
    Array.from(
      new Set(
        shipment.lines.map((line) => line.cn_code),
      ),
    );

  const optionsByCnCode =
    new Map(
      await Promise.all(
        distinctCnCodes.map(
          async (cnCode) => (
            [
              cnCode,
              await listAvailableActualEmissionData(
                supabase,
                orgSummary.context.org_id,
                cnCode,
              ),
            ] as const
          ),
        ),
      ),
    );

  // Marked PER LINE, on the server: whether choosing a dataset would
  // change anything depends on what that particular line already
  // carries, and the decision is made here from facts the client never
  // receives (the record's evidence set, its verifier -- who for shared
  // data is a member of another organization -- and the grant it is
  // read through). Only the resulting boolean is sent, so the disabled
  // control and the server's own refusal cannot disagree.
  const availableActualDataByLineId: Record<string, ActualEmissionDataOptionForLine[]> =
    {};

  for (const line of shipment.lines) {
    const listing =
      optionsByCnCode.get(line.cn_code);

    availableActualDataByLineId[line.id] =
      listing === undefined
        ? []
        : markActualOptionsForLine(
            listing,
            line.emission_determination,
          );
  }

  // Which ACTUAL-determined lines now have newer producer data available
  // -- purely an informational badge (see EmissionsCell), never anything
  // that changes what determination is actually in force.
  const actualDeterminationStaleness =
    await checkActualDeterminationStalenessByShipment(
      supabase,
      orgSummary.context.org_id,
      shipment.lines,
      shipment.reporting_period,
    );

  // S3 (v2.1.1 §9), default reference display: pure context for a line
  // determined from ACTUAL data -- "what would the regulatory default
  // say for this same classification/origin/route", never used in any
  // calculation. Only fetched for ACTUAL-determined lines: a
  // DEFAULT-determined line's own "Regulatory determination" section
  // already shows these exact figures live, so a second reference
  // fetch for it would be pure duplication.
  const regulatoryRepository =
    getRegulatoryRepository();

  const regulatoryCountryMapper =
    getRegulatoryCountryMapper();

  const actualDeterminedLines =
    shipment.lines.filter(
      (line) => line.emission_determination?.method === "ACTUAL",
    );

  const defaultReferenceByLineId: Record<string, DefaultReferenceDisplay> =
    Object.fromEntries(
      await Promise.all(
        actualDeterminedLines.map(
          async (line) => (
            [
              line.id,
              await getDefaultReferenceForLine(
                supabase,
                regulatoryRepository,
                regulatoryCountryMapper,
                orgSummary.context.org_id,
                {
                  shipmentId: shipment.id,
                  cnCode: line.cn_code,
                  originCountry: line.origin_country,
                  productionRouteIndicator: line.production_route?.source_route_indicator ?? null,
                },
              ),
            ] as const
          ),
        ),
      ),
    );

  // 2026-09-06 (S5 cross-phase hardening). READY used to be treated as
  // editable here, but supabase/migrations/20260904090000_p14_ready_
  // shipments_are_not_editable.sql (2026-09-04) made shipment_lines
  // writes DRAFT-only for every role, at both the RLS and trigger
  // layer -- Add line, Remove, and redetermine (all of which write
  // shipment_lines itself) were rendering fully active for a READY
  // shipment while every one of those writes was already guaranteed to
  // fail server-side. Matches the database's own editability boundary
  // for those three controls.
  const editable =
    shipment.status === "DRAFT";

  // 2026-09-07 (S5 review round 7, finding S5R7-A-B1). Recalculate is
  // NOT one of the three writes `editable` above governs -- it inserts
  // a calculation_results row, never touches shipment_lines itself --
  // and record_calculation_result (supabase/migrations/
  // 20260906210000_s5_calculation_result_refuses_ready.sql) was
  // DELIBERATELY widened, in the SAME S5 commit that narrowed
  // `editable` to DRAFT-only, to keep permitting exactly this write for
  // a READY (non-LOCKED) shipment's line, specifically so a
  // CALCULATION_ENGINE_OUTDATED line can be recalculated with the
  // current engine version WITHOUT forcing a full reopen/re-approve
  // cycle over a shipment whose own content never changed -- that
  // migration's own header comment states this in so many words. But
  // the SAME commit's UI change (this file, point 2) collapsed
  // Calculate/Recalculate's own visibility into the same DRAFT-only
  // `editable` flag as the other three controls, silently making the
  // backend's own sanctioned recovery path unreachable through any
  // control a real user could click -- reachable only via a direct RPC
  // call (exactly what tests/integration/declaration-filing-engine-
  // version.test.ts does). Kept separate from `editable` so this one
  // control's own visibility matches what the database will actually
  // allow, not what the other three (genuinely DRAFT-only) controls
  // allow.
  const canRecalculate =
    shipment.status === "DRAFT" || shipment.status === "READY";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Shipments", href: "/shipments" },
        { label: shipment.reference },
      ]}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {shipment.reference}
          </h1>

          <StatusBadge
            statusKey={shipmentStatusKey(shipment.status)}
          />
        </div>

        <TransitionActions
          shipmentId={shipment.id}
          status={shipment.status}
          lineCount={shipment.lines.length}
        />
      </div>

      <Card className="mb-4 p-4">
        <p className="text-xs font-medium text-[var(--text-tertiary)]">
          Total embedded emissions
        </p>

        {emissionsTotal.total.status === "NONE" ? (
          <>
            <p className="mt-1 text-lg font-medium text-[var(--text-secondary)]">
              Not yet calculated
            </p>

            {
              // 2026-09-07 (S5 review round 5, finding S5R5-A-1). When
              // every line is simultaneously stale, "Not yet
              // calculated" alone reads as "never touched" -- false
              // for a line that already has a frozen calculation,
              // excluded here only because it is stale (redetermined
              // without being recalculated), the identical distinction
              // PARTIAL's own staleLineCount caption already makes
              // just below.
              emissionsTotal.total.staleLineCount > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-warning-700)]">
                  {emissionsTotal.total.staleLineCount} of{" "}
                  {shipment.lines.length} line(s) were redetermined
                  since their last calculation -- their embedded
                  emissions are excluded from this total
                  {
                    // 2026-09-07 (S5 review round 12, finding S5R12-A-3,
                    // live-reproduced). "Until recalculated" implies
                    // eventual recoverability -- false once the shipment
                    // is LOCKED or VOID, since record_calculation_result
                    // refuses both statuses unconditionally, making the
                    // exclusion permanent, not merely pending. Reachable
                    // through ordinary actions: redetermine a line while
                    // DRAFT, mark READY, then LOCK, and the shipment
                    // reaches LOCKED still carrying a permanently-stale
                    // calculation. Never touched by any of rounds 4-11's
                    // own LOCKED-hedge fixes until now.
                    shipment.status === "LOCKED" || shipment.status === "VOID"
                      ? " permanently -- recalculation is no longer possible for this shipment."
                      : " until recalculated."
                  }
                </p>
              ) : null
            }
          </>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-[var(--text-primary)]">
              {emissionsTotal.total.total_tco2e}
              {" "}
              <span className="text-base font-normal text-[var(--text-tertiary)]">
                tCO2e
              </span>
            </p>

            {emissionsTotal.total.status === "PARTIAL" ? (
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                {emissionsTotal.total.calculatedLineCount} of{" "}
                {emissionsTotal.total.totalLineCount} lines calculated so far
              </p>
            ) : null}

            {
              // 2026-09-07 (S5 review round 4, finding S5R4-VOCAB-2).
              // "Calculated so far" reads as "the rest simply haven't
              // been done yet" -- false for a line that already HAS a
              // calculation but was excluded because it is STALE
              // (redetermined without being recalculated; its own
              // "Stale -- recalculate" badge is visible in the lines
              // table below). Named separately, matching how the
              // dataset-superseded exclusion just below already gets
              // its own caption rather than being folded into the bare
              // count.
              emissionsTotal.total.status === "PARTIAL" &&
              emissionsTotal.total.staleLineCount > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-warning-700)]">
                  {emissionsTotal.total.staleLineCount} of{" "}
                  {emissionsTotal.total.totalLineCount} line(s) were
                  redetermined since their last calculation -- their
                  embedded emissions are excluded from this total
                  {
                    // 2026-09-07 (S5 review round 12, finding S5R12-A-3).
                    // See the identical NONE-total caption above for the
                    // full reasoning -- same hedge, same reason.
                    shipment.status === "LOCKED" || shipment.status === "VOID"
                      ? " permanently -- recalculation is no longer possible for this shipment."
                      : " until recalculated."
                  }
                </p>
              ) : null
            }

            {
              // 2026-09-07 (S5 review round 11, finding S5R11-A-1, live-
              // reproduced). This caption used to say "redetermine before
              // filing" unconditionally -- impossible for a LOCKED
              // shipment (the `editable` flag above excludes LOCKED, and
              // shipment_lines writes are DRAFT-only at both RLS and
              // trigger layer), and a LOCKED shipment is not an edge case
              // here -- it is "the routine case for an amendment," the
              // same characterization this codebase already uses for the
              // identical hedge on the Reports page's own
              // DatasetSupersededLinesCard/EngineOutdatedLinesCard, the
              // declaration completeness card, and filedMessageFor.
              //
              // 2026-09-07 (S5 review round 12, findings S5R12-GUID-B1 and
              // S5R12-A-1, live-reproduced). Round 11's own fix was only a
              // 2-way branch (LOCKED vs everything else), which left TWO
              // gaps: (1) READY was folded into the "redetermine before
              // filing" branch, but redetermining writes shipment_lines
              // (DRAFT-only writable), so a READY-but-not-LOCKED shipment
              // needs "reopen it first" -- exactly the 3-way pattern
              // Reports page's own DatasetSupersededLinesCard (fixed
              // round 7, S5R7-A-B1) and completeness-report-card.tsx's own
              // `stale`/DATASET_SUPERSEDED branch already use; (2) VOID is
              // exactly as terminal as LOCKED (lifecycle.ts's own doc
              // comment: "LOCKED and VOID are terminal") but was never
              // checked at all. Now a genuine 4-way branch, matching the
              // wording already established on those two sibling
              // surfaces.
              emissionsTotal.datasetSupersededLineCount > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-warning-700)]">
                  {emissionsTotal.datasetSupersededLineCount} of{" "}
                  {shipment.lines.length} line(s) used a regulatory dataset
                  that has since been corrected
                  {shipment.status === "LOCKED"
                    ? " -- this shipment has already been LOCKED (the routine case for an amendment), so it cannot be redetermined through the normal declaration flow. Contact support."
                    : shipment.status === "VOID"
                    ? " -- this shipment has been voided and can never be edited or reopened. Contact support."
                    : shipment.status === "READY"
                    ? " -- this shipment is READY; reopen it first, then redetermine before filing."
                    : " -- redetermine before filing."}
                </p>
              ) : null
            }

            {
              // 2026-09-07 (S5 review round 10, finding S5R10-NUM-B1;
              // hedged round 11, finding S5R11-A-1; VOID added round 12,
              // finding S5R12-A-1). The identical caption shape as
              // datasetSupersededLineCount just above, one axis over --
              // round 8 (S5R8-A-B2) added this fact to the DECLARATION-
              // level completeness gate but never here, even though a
              // reader could see a confident total on this exact page and
              // only discover the filing gate would refuse it once they
              // reached the declaration screen. Deliberately STAYS a
              // 2-way branch (LOCKED/VOID vs everything else) rather than
              // adding a 3rd READY case the way the sibling
              // datasetSupersededLineCount caption above needed --
              // record_calculation_result (20260906210000) deliberately
              // still permits recalculating a READY line directly, no
              // reopen required, so "recalculate before filing" is
              // already accurate for READY.
              emissionsTotal.engineOutdatedLineCount > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-warning-700)]">
                  {emissionsTotal.engineOutdatedLineCount} of{" "}
                  {shipment.lines.length} line(s) were calculated by an
                  earlier version of the calculation engine
                  {shipment.status === "LOCKED"
                    ? " -- this shipment has already been LOCKED (the routine case for an amendment), so it cannot be recalculated through the normal declaration flow. Contact support."
                    : shipment.status === "VOID"
                    ? " -- this shipment has been voided and can never be edited or reopened. Contact support."
                    : " -- recalculate before filing."}
                </p>
              ) : null
            }
          </>
        )}
      </Card>

      <Card className="mb-4 p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[var(--text-tertiary)]">
              Release date
            </dt>

            <dd className="tabular-nums text-[var(--text-primary)]">
              {shipment.release_date}
            </dd>
          </div>

          <div>
            <dt className="text-[var(--text-tertiary)]">
              Reporting period
            </dt>

            <dd className="tabular-nums text-[var(--text-primary)]">
              {formatReportingPeriod(
                shipment.reporting_period,
              )}
            </dd>
          </div>

          <div>
            <dt className="text-[var(--text-tertiary)]">
              Customs MRN
            </dt>

            <dd className="text-[var(--text-primary)]">
              {shipment.customs_mrn ?? "—"}
            </dd>
          </div>

          <div>
            <dt className="text-[var(--text-tertiary)]">
              Customs procedure
            </dt>

            <dd className="text-[var(--text-primary)]">
              {shipment.customs_procedure ?? "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-4">
        <div className="border-b border-[var(--border-default)] p-4">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Lines
          </h2>

          {/*
            2026-09-06 (S5 cross-phase hardening). Explains WHY the
            lines below are now read-only, with the exact recovery path
            -- the database's own error message already says this
            (app.enforce_shipment_lines_parent_editable), this just
            surfaces it before a user has to attempt an edit to learn it.
          */}
          {shipment.status === "READY" ? (
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              This shipment is READY, which records the line population
              approved for filing -- reopen it (above) to edit lines,
              then mark it ready again.
            </p>
          ) : null}
        </div>

        <LinesTable
          shipmentId={shipment.id}
          shipmentStatus={shipment.status}
          lines={shipment.lines}
          editable={editable}
          canRecalculate={canRecalculate}
          latestCalculations={latestCalculations}
          availableActualDataByLineId={availableActualDataByLineId}
          actualDeterminationStaleness={actualDeterminationStaleness}
          defaultReferenceByLineId={defaultReferenceByLineId}
          datasetSupersededByLineId={datasetSupersededByLineId}
        />
      </Card>

      {editable ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
            Add a line
          </h2>

          <AddLineWizard
            shipmentId={shipment.id}
          />
        </Card>
      ) : null}
    </AppShell>
  );
}
