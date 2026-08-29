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
 * See components/shell/capability-not-available.tsx's doc comment for
 * why this exists. Every route under app/(importer)/** requires the
 * active org to hold IMPORTER_DECLARANT -- this is the single place
 * that's enforced on the read path, rather than duplicated into each
 * page.tsx (there are nine of them). The org-context/onboarding-
 * redirect fetch each page already does for its own purposes is
 * unaffected -- this fetches its own copy up front (Server Components
 * have no shared per-request cache for a plain Supabase call the way
 * fetch() gets one), which does mean the org lookup runs twice per
 * request (once here, once in the page). That's a minor, accepted
 * duplication, not a correctness issue -- matching this codebase's
 * existing "each page fetches its own context" style rather than
 * introducing a request-scoped memoization layer for this alone.
 */
export default async function ImporterLayout(
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

  if (!hasCapability(orgSummary.context, "IMPORTER_DECLARANT")) {
    return (
      <CapabilityNotAvailable
        requiredCapability="IMPORTER_DECLARANT"
      />
    );
  }

  return children;
}
