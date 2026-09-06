import type {
  SharingGrantStatus,
} from "./types";

/**
 * 2026-09-07 (S5 review round 4, finding S5R4-VOCAB-1). Nothing in this
 * codebase ever runs the ACTIVE -> EXPIRED transition on a time-lapse:
 * app.user_shared_installation_ids()'s own comment
 * (20260829260000) states this explicitly ("nothing in this slice runs
 * the EXPIRE transition... automatically -- no cron/scheduled job
 * exists yet"), confirmed again by 20260831120000's own header. The
 * only place `status` is ever written to the literal string 'EXPIRED'
 * is accept_sharing_grant_invitation(), and only for a grant that is
 * still INVITED (never accepted) whose offer window lapsed before
 * acceptance -- an already-ACTIVE grant's access window lapsing by
 * date never touches the `status` column at all. So a grant can sit
 * ACTIVE in storage for an indefinite time after its own `expires_at`
 * has passed.
 *
 * Every real access-control predicate in this codebase already
 * accounts for this correctly, combining `status = 'ACTIVE'` WITH an
 * explicit `expires_at is null or expires_at > now()` check
 * (app.user_shared_installation_ids(), activeGrantedInstallationIds in
 * check-actual-determination-staleness.ts, granteeNameIsDisclosable in
 * list-shared-data-status.ts). But a UI surface that renders the raw
 * `status` column alone -- not through one of those predicates -- was
 * not: it showed "Active" for a grant whose real access had already
 * lapsed, directly contradicting an adjacent field on the same row
 * (list-actual-determined-lines.ts's own "Access since revoked/expired"
 * annotation, list-shared-data-status.ts's own time-aware grantee-name
 * resolution) that correctly detected the exact same lapse.
 *
 * This is the single place that discrepancy is closed: every UI-facing
 * read of a grant's status should pass it through here first, rather
 * than rendering `grant.status` directly. Intentionally NOT a database
 * migration or a scheduled job -- introducing either would be new
 * infrastructure this S5 hardening phase does not call for (CLAUDE.md
 * §11's own "no new scope" instruction), and every real authorization
 * decision already reads the two columns together correctly; only the
 * DISPLAY layer needed to catch up to that same combination.
 */
export function effectiveSharingGrantStatus(
  status: SharingGrantStatus,
  expiresAt: string | null,
  now: Date,
): SharingGrantStatus {
  if (status !== "ACTIVE") {
    return status;
  }

  if (expiresAt === null) {
    return status;
  }

  return new Date(expiresAt) > now
    ? status
    : "EXPIRED";
}
