import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../components/shell/app-shell";

import {
  Card,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../src/application/organizations/get-current-org-context";

import {
  hasAdminAccess,
} from "../../../src/application/organizations/org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  listInstallations,
} from "../../../src/application/installations/manage-installations";

import {
  listEmissionData,
} from "../../../src/application/emissions/manage-emission-data";

import {
  listEvidenceFiles,
} from "../../../src/application/evidence/upload-evidence";

import {
  checkEmissionDataEvidenceCompleteness,
} from "../../../src/domain/emissions/snapshot-completeness";

import {
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

import {
  EmissionDataForm,
} from "../../(producer)/emission-data/emission-data-form";

import {
  EmissionDataList,
} from "../../(producer)/emission-data/emission-data-list";

/**
 * 2026-09-03 -- OWNER DECISION D2. The importer's own emissions-capture
 * screen, for installations it registered under External operators.
 *
 * This is the producer's emission-data screen, reached from the
 * importer side: the same components, the same Server Actions, the same
 * evidence upload and the same two-axis verification lifecycle. Nothing
 * is duplicated and nothing is relaxed -- an importer-entered record
 * must clear exactly the same evidence-completeness and verification
 * gates before it can back an ACTUAL determination, and the eligibility
 * checks that enforce that live in the application and the database,
 * not on this page.
 *
 * What differs is only which installations are listed, and that follows
 * from the org's own data rather than from this route: RLS scopes every
 * query to the caller's organisation, so an importer sees the external
 * installations it recorded and a producer sees its own.
 *
 * The wording is the part that has to be right. "Recorded by an
 * importer from an operator's information" and "attested by the
 * operator" are different claims, and this screen never lets the first
 * be mistaken for the second.
 */
export default async function ExternalEmissionsPage() {
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

  const [installations, records, evidenceFiles] =
    await Promise.all(
      [
        listInstallations(
          supabase,
          orgSummary.context.org_id,
        ),
        listEmissionData(
          supabase,
          orgSummary.context.org_id,
        ),
        listEvidenceFiles(
          supabase,
          orgSummary.context.org_id,
        ),
      ],
    );

  const installationNameById =
    new Map(
      installations.map(
        (installation) => (
          [installation.id, installation.name]
        ),
      ),
    );

  const evidenceFilesByEmissionDataId =
    new Map<string, typeof evidenceFiles>();

  for (
    const file of evidenceFiles
  ) {
    const existing =
      evidenceFilesByEmissionDataId.get(file.emission_data_id) ??
      [];

    existing.push(
      file,
    );

    evidenceFilesByEmissionDataId.set(
      file.emission_data_id,
      existing,
    );
  }

  return (
    <AppShell
      experience="importer"
      breadcrumbs={[
        { label: "External emissions" },
      ]}
      activeNavLabel="External emissions"
    >
      <div className="mb-4 flex max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          External emissions
        </h1>

        <p className="text-sm text-[var(--text-secondary)]">
          Emissions information supplied to you by operators that do not
          use Snowkap, recorded against the installations you registered
          under External operators. Attach the documentation the operator
          gave you, then take each record through verification -- the
          same lifecycle a producer&apos;s own data goes through, and the
          same conditions before it can determine a shipment line.
        </p>

        <p className="text-sm text-[var(--text-secondary)]">
          Recording data here does not certify it. Everything entered is
          labelled as external operator data wherever it appears,
          including on the number it eventually produces.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              Record actual emissions
            </CardTitle>
          </CardHeader>

          <EmissionDataForm
            installations={installations.map(
              (installation) => (
                {
                  id: installation.id,
                  name: installation.name,
                }
              ),
            )}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Emission data
            </CardTitle>
          </CardHeader>

          <EmissionDataList
            isAdmin={hasAdminAccess(orgSummary.context)}
            records={records.map(
              (record) => {
                // LIVE, re-derived from the record's CURRENT
                // evidence_file_ids on every render -- never a stored
                // flag -- so the "Incomplete" state here always matches
                // exactly what verifyEmissionData/activateEmissionData/
                // fetchAuthorizedEmissionData would themselves decide
                // right now (src/application/emissions). See the owner's
                // blocking-model directive and this function's own doc
                // comment (src/domain/emissions/snapshot-completeness.ts).
                const completeness =
                  checkEmissionDataEvidenceCompleteness(
                    record,
                  );

                return {
                  id: record.id,
                  installationName: installationNameById.get(record.installation_id) ?? "Unknown installation",
                  cnScope: record.cn_scope,
                  periodLabel: formatReportingPeriod(record.period),
                  directSpecific: record.direct_specific,
                  indirectSpecific: record.indirect_specific,
                  emissionUnit: record.emission_unit,
                  methodology: record.methodology,
                  verificationStatus: record.verification_status,
                  status: record.status,
                  rejectionReason: record.rejection_reason,
                  version: record.version,
                  evidenceComplete: completeness.status === "COMPLETE",
                  missingEvidenceFields: completeness.status === "INCOMPLETE" ? completeness.missingFields : [],
                  evidenceFiles: (evidenceFilesByEmissionDataId.get(record.id) ?? []).map(
                    (file) => (
                      {
                        id: file.id,
                        originalFilename: file.original_filename,
                        sizeBytes: file.size_bytes,
                        mimeType: file.mime_type,
                        createdAt: file.created_at,
                      }
                    ),
                  ),
                };
              },
            )}
          />
        </Card>
      </div>
    </AppShell>
  );
}
