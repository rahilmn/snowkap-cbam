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
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

import {
  EmissionDataForm,
} from "./emission-data-form";

import {
  EmissionDataList,
} from "./emission-data-list";

export default async function EmissionDataPage() {
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
      experience="producer"
      breadcrumbs={[
        { label: "Emissions" },
      ]}
      activeNavLabel="Emissions"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Emissions
      </h1>

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
              (record) => (
                {
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
                }
              ),
            )}
          />
        </Card>
      </div>
    </AppShell>
  );
}
