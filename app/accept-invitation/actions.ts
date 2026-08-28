"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  acceptInvitation,
} from "../../src/application/organizations/invitations";

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
