import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import type {
  Invitation,
} from "./types";

/**
 * How a PENDING invitation should be described to a human right now.
 *
 * WHY THIS IS NEEDED. `organization_invitations.status` has no EXPIRED
 * value: a row sits at PENDING until someone tries to accept it, and the
 * RPC flips it only at that moment. The two SELECT policies then disagree
 * about what a lapsed row is -- _select_own_email carries
 * `expires_at > now()`, so a plain invitee stops seeing it, while
 * _select_admin_or_owner carries no expiry predicate at all, so the
 * inviting admin keeps seeing it looking exactly like a live one.
 *
 * Verified against real RLS on 2026-09-03 with a rolled-back probe.
 *
 * So the admin's Team screen needs to say "Expired" itself; nothing in
 * the database will say it for them, and an admin who believes a lapsed
 * invitation is still working will wait instead of re-sending it.
 */
export type InvitationDisplayState =
  | "AWAITING_ACCEPTANCE"
  | "EXPIRED";

export function describeInvitationState(
  invitation: Pick<Invitation, "status" | "expires_at">,
  now: IsoTimestamp,
): InvitationDisplayState {
  if (invitation.status !== "PENDING") {
    return "AWAITING_ACCEPTANCE";
  }

  // Deliberately one tick STRICTER than the acceptance RPC, which uses
  // `expires_at < now()` and so still accepts at exact equality
  // (20260828130000). At the boundary the UI would rather say "expired"
  // about something that would just barely work than say "awaiting" about
  // something that has already stopped working: the first costs a
  // needless re-invite, the second costs a user who keeps clicking a dead
  // link. The window is one instant wide and no product path can aim at
  // it.
  return new Date(invitation.expires_at) <= new Date(now)
    ? "EXPIRED"
    : "AWAITING_ACCEPTANCE";
}
