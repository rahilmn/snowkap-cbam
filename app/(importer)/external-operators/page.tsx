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
} from "../../(producer)/installations/operator-form";

import {
  OperatorList,
} from "../../(producer)/installations/operator-list";

import {
  InstallationForm,
} from "../../(producer)/installations/installation-form";

import {
  InstallationList,
} from "../../(producer)/installations/installation-list";

import {
  createExternalOperatorAction,
  createExternalInstallationAction,
} from "../../(producer)/installations/actions";

/**
 * 2026-09-03 -- OWNER DECISION D2. The importer's register of external
 * operators and installations.
 *
 * A real importer has many suppliers and only some of them are on
 * Snowkap. Before this screen, emissions data for the rest could not be
 * recorded at all: the operator and installation services required
 * PRODUCER_OPERATOR, so the entire actual-emissions path was
 * conditional on a third-country operator deciding to sign up.
 *
 * WHAT THIS IS NOT. It is not a way for an importer to certify
 * emissions. Records created here carry provenance IMPORTER_ENTERED,
 * which means "transcribed from information an external operator
 * supplied" -- never "invented" and never "self-certified" -- and every
 * surface that renders one says so, including the dataset picker, the
 * "Why this number?" panel and the period exports.
 *
 * Nothing about eligibility is relaxed. A record entered here still has
 * to go through the same evidence and verification lifecycle before it
 * can back an ACTUAL determination. Captured data, verified data and
 * calculation-eligible data stay three different things.
 *
 * WHY IT REUSES THE PRODUCER'S COMPONENTS AND ACTIONS. Because it is
 * the same aggregate with a different provenance, and D2's own
 * instruction was to extend the existing architecture rather than build
 * a second parallel model. The forms take their submit action as a prop
 * for exactly this reason; the actions are one implementation
 * parameterised by provenance. A copy would have drifted the first time
 * either side gained a field.
 */
export default async function ExternalOperatorsPage() {
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
      experience="importer"
      breadcrumbs={[
        { label: "External operators" },
      ]}
      activeNavLabel="External operators"
    >
      <div className="mb-4 flex max-w-2xl flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          External operators
        </h1>

        <p className="text-sm text-[var(--text-secondary)]">
          Record the operators and installations behind your imports when
          they do not use Snowkap themselves. You are capturing
          information the operator supplied to you, not certifying it.
          Snowkap labels everything entered here as external operator
          data everywhere it appears.
        </p>

        <p className="text-sm text-[var(--text-secondary)]">
          Once an installation exists here, record its emissions under
          External emissions, attach the operator&apos;s supporting
          documentation, and take it through verification before using it
          to determine a shipment line.
        </p>
      </div>

      <div className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              Operators
            </CardTitle>
          </CardHeader>

          <OperatorForm
            action={createExternalOperatorAction}
          />

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
            action={createExternalInstallationAction}
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
