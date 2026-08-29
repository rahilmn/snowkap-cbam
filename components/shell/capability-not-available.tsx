import {
  AppShell,
} from "./app-shell";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

import type {
  OrganizationCapability,
} from "../../src/domain/organizations/types";

const CAPABILITY_LABEL: Record<
  OrganizationCapability,
  string
> = {
  IMPORTER_DECLARANT: "Importer / Declarant",
  PRODUCER_OPERATOR: "Third-country Producer / Operator",
};

/**
 * 2026-08-30 (P13 final non-blocked-work audit, follow-up hardening):
 * navigating directly to an importer-only URL (e.g. /shipments) from a
 * producer-only-capability org previously rendered the full page shell
 * -- an empty list, a working "New shipment" button, a working create
 * form -- and only refused the write at submit time ("Your
 * organization is not set up as a CBAM importer/declarant"). The write
 * was never actually at risk (the application-layer capability check
 * already held), but the read path gave no indication anything was
 * wrong until after filling out a form. This is the shared denial
 * state both route-group layouts (app/(importer)/layout.tsx,
 * app/(producer)/layout.tsx) render instead of `children` when the
 * active org lacks the capability that route group requires --
 * rendered inside the normal AppShell (not a bare full-screen
 * takeover) so the sidebar/org-switcher/nav stay usable, since this is
 * a wrong-org-selected state, not an authentication or fatal error.
 */
export function CapabilityNotAvailable(
  {
    requiredCapability,
  }: {
    requiredCapability: OrganizationCapability;
  },
) {
  return (
    <AppShell
      breadcrumbs={[
        { label: "Not available" },
      ]}
    >
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>
            Not available for this organization
          </CardTitle>

          <CardDescription>
            This section requires the &quot;
            {CAPABILITY_LABEL[requiredCapability]}
            &quot; capability, which the currently active organization
            doesn&apos;t have enabled.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-[var(--text-secondary)]">
            An OWNER can add this capability from Organization settings,
            or you can switch to a different organization using the
            org switcher above.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
