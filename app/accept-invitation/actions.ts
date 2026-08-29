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
  acceptInvitation,
} from "../../src/application/organizations/invitations";

import {
  acceptSharingGrantInvitation,
} from "../../src/application/sharing/manage-sharing-grants";

import type {
  AcceptInvitationActionState,
} from "./action-state";

const acceptInvitationSchema =
  z.object({
    invitationId:
      z.string().min(1),
  });

export async function acceptInvitationAction(
  _previousState: AcceptInvitationActionState,
  formData: FormData,
): Promise<AcceptInvitationActionState> {
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
        message: "This invitation has already been used.",
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
  });

/**
 * Accepts a bootstrap (invited-by-email) sharing_grants row into the
 * caller's own currently active org (resolved server-side via
 * getCurrentOrgSummary, same as every other action in this codebase --
 * never trusted from client input) -- see
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
  const parsed =
    acceptSharingGrantInvitationSchema.safeParse(
      {
        grantId: formData.get("grantId"),
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

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You need to belong to an organization before you can accept a data-sharing invitation.",
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
