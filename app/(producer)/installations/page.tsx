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
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  listOperators,
} from "../../../src/application/installations/manage-operators";

import {
  listInstallations,
} from "../../../src/application/installations/manage-installations";

import {
  OperatorForm,
} from "./operator-form";

import {
  OperatorList,
} from "./operator-list";

import {
  InstallationForm,
} from "./installation-form";

import {
  InstallationList,
} from "./installation-list";

export default async function InstallationsPage() {
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

  const [operators, installations] =
    await Promise.all(
      [
        listOperators(
          supabase,
          orgSummary.context.org_id,
        ),
        listInstallations(
          supabase,
          orgSummary.context.org_id,
        ),
      ],
    );

  const operatorNameById =
    new Map(
      operators.map(
        (operator) => (
          [operator.id, operator.name]
        ),
      ),
    );

  return (
    <AppShell
      experience="producer"
      breadcrumbs={[
        { label: "Installations" },
      ]}
      activeNavLabel="Installations"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Installations
      </h1>

      <div className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              Operators
            </CardTitle>
          </CardHeader>

          <OperatorForm />

          <OperatorList
            operators={operators.map(
              (operator) => (
                {
                  id: operator.id,
                  name: operator.name,
                  country: operator.country,
                  contactEmail: operator.contact_email,
                  provenance: operator.provenance,
                }
              ),
            )}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Installations
            </CardTitle>
          </CardHeader>

          <InstallationForm
            operators={operators.map(
              (operator) => (
                {
                  id: operator.id,
                  name: operator.name,
                }
              ),
            )}
          />

          <InstallationList
            installations={installations.map(
              (installation) => (
                {
                  id: installation.id,
                  operatorName: operatorNameById.get(installation.operator_id) ?? "Unknown operator",
                  name: installation.name,
                  country: installation.country,
                  unLocode: installation.un_locode,
                  address: installation.address,
                  provenance: installation.provenance,
                }
              ),
            )}
          />
        </Card>
      </div>
    </AppShell>
  );
}
