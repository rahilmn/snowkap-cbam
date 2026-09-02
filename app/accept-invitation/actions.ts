"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  getClientIp,
} from "../../components/shell/get-client-ip";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../src/infrastructure/rate-limit/rate-limiter";

import {
  acceptInvitation,
} from "../../src/application/organizations/invitations";

import {
  acceptSharingGrantInvitation,
} from "../../src/application/sharing/manage-sharing-grants";

import type {
  AcceptInvitationActionState,
} from "./action-state";

/**
 * Both invitationId and grantId are opaque, high-entropy identifiers
 * (see acceptInvitation/acceptSharingGrantInvitation's own callers --
 * these are never sequential or guessable in one try), but each
 * action here surfaces a DIFFERENT message per outcome (EXPIRED vs
 * EMAIL_MISMATCH vs NOT_PENDING vs "not found," see the switch
 * statements below) -- exactly the kind of existence oracle that
 * turns "cannot be guessed in one try" into "can be swept for hits
 * across many tries," which is what master plan §28's "sharing
 * endpoints" callout for rate limiting exists to bound. Both actions
 * read the caller's Supabase user only AFTER this check (getUser() is
 * itself a real Supabase Auth round-trip -- see proxy.ts's own doc
 * comment on why getUser(), never getSession(), is used for anything
 * authorization-relevant), so keying on IP (read from headers(), no
 * Supabase call needed) rather than the not-yet-known user lets a
 * rejected request short-circuit before any I/O at all, the same
 * ordering app/(auth)/actions.ts's SIGN_IN/SIGN_UP limiters use.
 */
function tooManyAttemptsState(
  retryAfterMs: number,
): AcceptInvitationActionState {
  const retryAfterSeconds =
    Math.ceil(retryAfterMs / 1000);

  return {
    status: "error",
    message:
      `Too many attempts. Try again in ${retryAfterSeconds} ` +
      `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
  };
}

/**
 * ACCEPT_INVITATION: a real user clicks one link from one email and
 * submits this once (see acceptInvitationAction's own redirect() on
 * every non-error outcome, which leaves the page entirely -- there is
 * no legitimate "submit many times in a row" flow here the way
 * ACCEPT_SHARING_GRANT below has). 20 attempts per 10 minutes per IP
 * is generous headroom over that single expected submission while
 * still keeping an automated sweep of many invitationId guesses from
 * the same IP down to roughly one every 30 seconds.
 */
const ACCEPT_INVITATION_RATE_LIMIT: RateLimitConfig =
  {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  };

const acceptInvitationLimiter =
  createInMemoryRateLimiter(
    ACCEPT_INVITATION_RATE_LIMIT,
  );

/**
 * ACCEPT_SHARING_GRANT: unlike ACCEPT_INVITATION above, this action's
 * own doc comment explains it deliberately does NOT redirect on
 * success, specifically so one visit can accept a whole stack of
 * pending grants back-to-back (a producer may invite the same
 * importer to several installations). A slightly higher ceiling --
 * 30 per 10 minutes per IP -- covers that legitimate multi-accept
 * flow with room to spare while still bounding an automated grantId
 * sweep to the same rough order of magnitude as ACCEPT_INVITATION's.
 */
const ACCEPT_SHARING_GRANT_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const acceptSharingGrantLimiter =
  createInMemoryRateLimiter(
    ACCEPT_SHARING_GRANT_RATE_LIMIT,
  );

const acceptInvitationSchema =
  z.object({
    invitationId:
      z.string().min(1),
  });

export async function acceptInvitationAction(
  _previousState: AcceptInvitationActionState,
  formData: FormData,
): Promise<AcceptInvitationActionState> {
  const acceptInvitationRateLimitResult =
    acceptInvitationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!acceptInvitationRateLimitResult.allowed) {
    return tooManyAttemptsState(
      acceptInvitationRateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    acceptInvitationSchema.safeParse(
      {
        invitationId: formData.get("invitationId"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid request.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const result =
    await acceptInvitation(
      supabase,
      parsed.data.invitationId as never,
    );

  switch (result.status) {
    case "OK":
    case "ALREADY_MEMBER":
      revalidatePath(
        "/team",
      );

      redirect(
        "/",
      );

    case "EXPIRED":
      return {
        status: "error",
        message: "This invitation has expired. Ask the organization to send a new one.",
      };

    case "EMAIL_MISMATCH":
      return {
        status: "error",
        message: "This invitation was sent to a different email address than the one you're signed in with.",
      };

    case "NOT_PENDING":
      return {
        status: "error",
        message: "This invitation is no longer valid -- it was already used or has "
          + "been revoked. Ask the organization to send a new one.",
      };

    // Deliberately not folded into the default: this invitation is
    // valid and still PENDING (the RPC leaves it that way -- see
    // 20260829360000 §7), so "could not be found" would be both wrong
    // and a dead end. The person's earlier membership of this org was
    // deactivated, and only an admin can lift that.
    case "MEMBERSHIP_DEACTIVATED":
      return {
        status: "error",
        message: "Your access to this organization was deactivated. Ask an administrator there to reactivate you — this invitation stays valid until they do.",
      };

    default:
      return {
        status: "error",
        message: "That invitation could not be found.",
      };
  }
}

const acceptSharingGrantInvitationSchema =
  z.object({
    grantId:
      z.string().min(1),
    // 2026-09-03 (P14). The organization to bind the grant to, chosen
    // explicitly by the user. uuid() rather than min(1) so a malformed
    // value is refused before it reaches getCurrentOrgSummary, whose
    // fallback behaviour is precisely what must not be relied on here.
    orgId:
      z.string().uuid(),
  });

/**
 * Accepts a bootstrap (invited-by-email) sharing_grants row into an org
 * the caller EXPLICITLY chose (submitted as orgId and re-validated
 * server-side against their own memberships via getCurrentOrgSummary --
 * the id is client-supplied, so membership is what authorizes it, never
 * the id itself; see the comment inside the action on why the cookie is
 * deliberately not read here) -- see
 * src/application/sharing/manage-sharing-grants.ts's own doc comment on
 * acceptSharingGrantInvitation for why this needs an org, unlike
 * acceptInvitation above (which resolves org_id FROM the invitation
 * itself). Deliberately does not redirect on success (unlike
 * acceptInvitationAction) -- a producer may have invited the same
 * importer to more than one installation, so staying on this page lets
 * the user accept every pending item in one visit.
 */
export async function acceptSharingGrantInvitationAction(
  _previousState: AcceptInvitationActionState,
  formData: FormData,
): Promise<AcceptInvitationActionState> {
  const acceptSharingGrantRateLimitResult =
    acceptSharingGrantLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!acceptSharingGrantRateLimitResult.allowed) {
    return tooManyAttemptsState(
      acceptSharingGrantRateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    acceptSharingGrantInvitationSchema.safeParse(
      {
        grantId: formData.get("grantId"),
        orgId: formData.get("orgId"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid request.",
    };
  }

  const supabase =
    await getServerSupabaseClient();

  // 2026-09-03 (P14). The organization is taken from the SUBMITTED
  // field, not from the active-organization cookie, and it is not
  // allowed to fall back.
  //
  // Accepting binds a producer's verified emissions data to this
  // organization permanently -- app.prevent_sharing_grant_fact_change
  // permits grantee_org_id to change exactly once, from null -- and
  // admits every member of it to that data. Reading the cookie meant a
  // user belonging to two organizations bound the grant to whichever
  // one they happened to be acting as, with nothing in the flow
  // surfacing the choice; app/accept-invitation/accept-sharing-grant-
  // list.tsx now makes them pick.
  //
  // getCurrentOrgSummary treats its argument as a PREFERENCE and falls
  // back to the caller's oldest membership when it does not match one
  // (a deliberate, documented behaviour for the shell's org switcher).
  // A silent fallback is exactly the defect being closed here, so the
  // resolved context is compared against the submitted id and the
  // request is refused when they differ -- an id the caller is not a
  // member of, or a stale one from a revoked membership.
  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      parsed.data.orgId,
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You need to belong to an organization before you can accept a data-sharing invitation.",
    };
  }

  if (orgSummary.context.org_id !== parsed.data.orgId) {
    return {
      status: "error",
      message: "You are not a member of the organization you chose. Reload the page and try again.",
    };
  }

  const result =
    await acceptSharingGrantInvitation(
      supabase,
      orgSummary.context,
      parsed.data.grantId as never,
    );

  switch (result.status) {
    case "OK":
      revalidatePath(
        "/accept-invitation",
      );

      return {
        status: "idle",
      };

    case "EXPIRED":
      return {
        status: "error",
        message: "This invitation has expired. Ask the producer to send a new one.",
      };

    case "EMAIL_MISMATCH":
      return {
        status: "error",
        message: "This invitation was sent to a different email address than the one you're signed in with.",
      };

    case "NOT_PENDING":
      return {
        status: "error",
        message: "This invitation has already been used or revoked.",
      };

    case "SELF_GRANT_NOT_ALLOWED":
      return {
        status: "error",
        message: "You can't accept an invitation into the organization that issued it.",
      };

    case "NOT_A_MEMBER":
      return {
        status: "error",
        message: "You are not a member of your currently active organization.",
      };

    case "CAPABILITY_NOT_HELD":
      return {
        status: "error",
        message:
          "Shared emissions data can only be accepted into an importer / " +
          "declarant organization. Switch to one and try again.",
      };

    case "ALREADY_GRANTED":
      return {
        status: "error",
        message: "Your organization already has access to this installation's data through another grant.",
      };

    default:
      return {
        status: "error",
        message: "That invitation could not be found.",
      };
  }
}
