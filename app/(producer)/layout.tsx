import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  hasCapability,
} from "../../src/application/organizations/org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  CapabilityNotAvailable,
} from "../../components/shell/capability-not-available";

/**
 * Mirror of app/(importer)/layout.tsx for the producer side -- see
 * that file's doc comment and components/shell/capability-not-
 * available.tsx's for the full reasoning. Every route under
 * app/(producer)/** requires PRODUCER_OPERATOR.
 */
export default async function ProducerLayout(
  {
    children,
  }: {
    children: React.ReactNode;
  },
) {
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

  if (!hasCapability(orgSummary.context, "PRODUCER_OPERATOR")) {
    return (
      <CapabilityNotAvailable
        requiredCapability="PRODUCER_OPERATOR"
      />
    );
  }

  return children;
}
