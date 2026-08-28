"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  changeMemberRole,
  removeMember,
} from "../../src/application/organizations/manage-membership";

import type {
  TeamActionState,
} from "./action-state";

function messageFor(
  reason: string,
): string {
  switch (reason) {
    case "LAST_OWNER":
      return "This organization must always have at least one OWNER.";

    case "MEMBERSHIP_NOT_FOUND":
      return "That member no longer exists.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const changeRoleSchema =
  z.object({
    membershipId:
      z.string().min(1),

    role:
      z.enum(["OWNER", "ADMIN", "MEMBER"]),
  });

export async function changeRoleAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed =
    changeRoleSchema.safeParse(
      {
        membershipId: formData.get("membershipId"),
        role: formData.get("role"),
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
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You are not a member of an organization.",
    };
  }

  const result =
    await changeMemberRole(
      supabase,
      orgSummary.context.org_id,
      parsed.data.membershipId as never,
      parsed.data.role,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: messageFor(result.reason),
    };
  }

  revalidatePath(
    "/team",
  );

  return {
    status: "idle",
  };
}

const removeMemberSchema =
  z.object({
    membershipId:
      z.string().min(1),
  });

export async function removeMemberAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed =
    removeMemberSchema.safeParse(
      {
        membershipId: formData.get("membershipId"),
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
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You are not a member of an organization.",
    };
  }

  const result =
    await removeMember(
      supabase,
      orgSummary.context.org_id,
      parsed.data.membershipId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: messageFor(result.reason),
    };
  }

  revalidatePath(
    "/team",
  );

  return {
    status: "idle",
  };
}
