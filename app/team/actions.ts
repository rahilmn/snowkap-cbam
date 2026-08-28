"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import { headers } from "next/headers";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getSupabaseAdminClient,
} from "../../src/infrastructure/supabase/admin-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  changeMemberRole,
  removeMember,
} from "../../src/application/organizations/manage-membership";

import {
  inviteMember,
  revokeInvitation,
} from "../../src/application/organizations/invitations";

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

/**
 * The current request's own origin, for building the invite email's
 * redirect URL -- there is no APP_URL env var yet (deferred to P11's
 * environment matrix per docs/plans/MASTER_PLAN.md §41), and deriving
 * it from the request itself works correctly in every environment
 * (local, staging, production) without needing one.
 */
async function getAppOrigin(): Promise<string> {
  const headerList =
    await headers();

  const host =
    headerList.get(
      "x-forwarded-host",
    ) ?? headerList.get(
      "host",
    ) ?? "localhost:3000";

  const protocol =
    headerList.get(
      "x-forwarded-proto",
    ) ?? (
      host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https"
    );

  return `${protocol}://${host}`;
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

const inviteMemberSchema =
  z.object({
    email:
      z.string().email(),

    role:
      z.enum(["ADMIN", "MEMBER"]),
  });

export async function inviteMemberAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed =
    inviteMemberSchema.safeParse(
      {
        email: formData.get("email"),
        role: formData.get("role"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address.",
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

  const origin =
    await getAppOrigin();

  const result =
    await inviteMember(
      supabase,
      getSupabaseAdminClient(),
      {
        orgId: orgSummary.context.org_id,
        email: parsed.data.email,
        role: parsed.data.role,
        // Lands on the client-side session handler first, not
        // /accept-invitation directly -- see app/auth/callback/page.tsx's
        // doc comment for why the invite link delivers its session via
        // a hash fragment that only a client component can read.
        redirectTo: `${origin}/auth/callback?next=/accept-invitation`,
      },
    );

  revalidatePath(
    "/team",
  );

  switch (result.status) {
    case "OK":
      return {
        status: "idle",
      };

    case "OK_EMAIL_NOT_SENT":
      return {
        status: "error",
        message:
          "The invitation was created, but the email couldn't be sent " +
          "(this can happen if the person already has a Snowkap account). " +
          "Ask them to sign in and visit /accept-invitation.",
      };

    case "ALREADY_PENDING":
      return {
        status: "error",
        message: "There is already a pending invitation for that email.",
      };

    default:
      return {
        status: "error",
        message: "Something went wrong. Please try again.",
      };
  }
}

const revokeInvitationSchema =
  z.object({
    invitationId:
      z.string().min(1),
  });

export async function revokeInvitationAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed =
    revokeInvitationSchema.safeParse(
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

  const result =
    await revokeInvitation(
      supabase,
      parsed.data.invitationId as never,
    );

  if (result.status === "PERSIST_FAILED") {
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    "/team",
  );

  return {
    status: "idle",
  };
}
