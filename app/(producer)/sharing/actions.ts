"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  issueSharingGrant,
  revokeSharingGrant,
} from "../../../src/application/sharing/manage-sharing-grants";

import type {
  SharingScreenActionState,
} from "./action-state";

async function requireOrgContext() {
  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return {
      status: "error" as const,
      message: "You are not a member of an organization.",
    };
  }

  return {
    status: "ok" as const,
    supabase,
    orgSummary,
  };
}

const inviteByEmailSchema =
  z.object({
    installationId:
      z.string().min(1, "Choose an installation."),

    email:
      z.string().email("Enter a valid email address."),
  });

/**
 * Issues a bootstrap (invited-by-email) sharing grant -- the producer
 * doesn't yet know the importer's org, so this screen only exposes the
 * email-invite input (see app/(producer)/sharing/page.tsx's own doc
 * comment for why the direct-org-id path has no UI here).
 */
export async function inviteByEmailAction(
  _previousState: SharingScreenActionState,
  formData: FormData,
): Promise<SharingScreenActionState> {
  const parsed =
    inviteByEmailSchema.safeParse(
      {
        installationId: formData.get("installationId"),
        email: formData.get("email"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Check the form and try again.",
    };
  }

  const setup =
    await requireOrgContext();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await issueSharingGrant(
      setup.supabase,
      setup.orgSummary.context,
      {
        installationId: parsed.data.installationId as never,
        invitedEmail: parsed.data.email,
      },
    );

  if (result.status === "REJECTED") {
    const message =
      result.reason === "PERMISSION_DENIED"
        ? "Only an ADMIN or OWNER can share data."
        : result.reason === "INSTALLATION_NOT_FOUND"
        ? "Choose a valid installation."
        : result.reason === "INVALID_INPUT"
        ? "Enter a valid email address."
        : "Something went wrong. Please try again.";

    return {
      status: "error",
      message,
    };
  }

  revalidatePath(
    "/sharing",
  );

  return {
    status: "idle",
  };
}

const revokeSharingGrantSchema =
  z.object({
    grantId:
      z.string().min(1),
  });

export async function revokeSharingGrantAction(
  _previousState: SharingScreenActionState,
  formData: FormData,
): Promise<SharingScreenActionState> {
  const parsed =
    revokeSharingGrantSchema.safeParse(
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

  const setup =
    await requireOrgContext();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await revokeSharingGrant(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.grantId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    "/sharing",
  );

  return {
    status: "idle",
  };
}
