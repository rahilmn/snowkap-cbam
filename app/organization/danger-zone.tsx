import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";

import {
  formatDate,
} from "../../lib/utils";

/**
 * Master plan §27 screen 24 calls for a "Danger zone" on this screen.
 * This page already redirects any non-OWNER to "/" before rendering
 * (see page.tsx), matching this codebase's own convention for a
 * whole-page role gate (contrast hasAdminAccess, org-context.ts, used
 * where ADMIN-or-OWNER share a screen) -- so there is no second,
 * narrower role check to make just for this section.
 *
 * Scope is deliberately narrow. This product has no genuine destructive
 * OWNER-only capability yet -- no org deletion, no ownership transfer --
 * and building one now, as a UI afterthought to a members/roles polish
 * pass, is exactly the kind of destructive-production-operation change
 * this engagement's standing rules put through its own explicit design
 * and a human decision first (see CLAUDE.md's escalation triggers and
 * docs/adr/ADR-0013). So rather than a button with no real capability
 * behind it, this section holds:
 *   (1) the org's own audit-relevant identity -- useful when filing a
 *       support request, or cross-referencing an audit_events row back
 *       to the organization that produced it -- and
 *   (2) an honest statement of what deletion is not yet possible here,
 *       so an OWNER looking for it finds a straight answer instead of a
 *       dead end.
 */
export function DangerZone(
  {
    organization,
  }: {
    organization: {
      id: string;
      slug: string;
      createdAt: string;
    };
  },
) {
  return (
    <Card className="max-w-2xl border-[var(--color-danger-700)]">
      <CardHeader>
        <CardTitle className="text-base text-[var(--color-danger-700)]">
          Danger zone
        </CardTitle>

        <CardDescription>
          Consequential, organization-wide information. Visible to the
          OWNER only.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Organization identity
          </h3>

          <p className="text-xs text-[var(--text-tertiary)]">
            Reference details for support requests and audit records --
            not editable here.
          </p>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-[var(--text-secondary)]">
              Organization ID
            </dt>

            <dd className="break-all font-mono text-[var(--text-primary)]">
              {organization.id}
            </dd>

            <dt className="text-[var(--text-secondary)]">
              Slug
            </dt>

            <dd className="break-all font-mono text-[var(--text-primary)]">
              {organization.slug}
            </dd>

            <dt className="text-[var(--text-secondary)]">
              Created
            </dt>

            <dd className="text-[var(--text-primary)]">
              {formatDate(organization.createdAt)}
            </dd>
          </dl>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-[var(--border-default)] pt-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Delete organization
          </h3>

          <p className="text-sm text-[var(--text-secondary)]">
            Not yet supported. Permanently deleting an organization and
            its data is a materially larger, higher-risk capability that
            Snowkap has deliberately not built yet -- it needs its own
            explicit design and review before it exists anywhere in the
            product, not a button added here as an afterthought. If you
            need to close out an organization today, contact Snowkap
            support.
          </p>
        </div>
      </div>
    </Card>
  );
}
