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

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import type {
  SharingScreenActionState,
} from "./action-state";

/**
 * 2026-08-29 (P11 mandatory security review, N4, SHOULD-FIX): master
 * plan §28 names "sharing endpoints" by name; neither action in this
 * file was rate-limited. inviteByEmailAction writes a real
 * sharing_grants row keyed on an attacker-chosen invited_email (the
 * bootstrap-invite path, mirroring inviteMemberAction's own abuse risk
 * -- see app/team/actions.ts's matching comment), so it's rate-limited
 * the same way; revokeSharingGrantAction is a mutation endpoint. Same
 * IP-keyed pattern as every other limiter in this codebase.
 *
 * CORRECTION, 2026-08-29 (P13 audit finding): this comment previously
 * stated inviteByEmailAction "sends a real email" -- confirmed false.
 * issueSharingGrant (manage-sharing-grants.ts) only inserts the
 * sharing_grants row; nothing in this codebase sends mail for the
 * sharing-grant bootstrap path (contrast app/team/actions.ts's
 * inviteMemberAction, which genuinely does call
 * getSupabaseAdminClient().auth.admin.inviteUserByEmail()). An invited
 * person with no existing Snowkap account today has no way to learn a
 * grant is pending for them -- a real, open product gap (ADR-0012 names
 * "an email carrying a signed, expiring token" as the intended
 * mechanism), tracked for a follow-up, not fixed here.
 */
const INVITE_BY_EMAIL_RATE_LIMIT: RateLimitConfig =
  {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  };

const inviteByEmailLimiter =
  createInMemoryRateLimiter(
    INVITE_BY_EMAIL_RATE_LIMIT,
  );

const REVOKE_SHARING_GRANT_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const revokeSharingGrantLimiter =
  createInMemoryRateLimiter(
    REVOKE_SHARING_GRANT_RATE_LIMIT,
  );

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
  const inviteRateLimitResult =
    inviteByEmailLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!inviteRateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(inviteRateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many invitations sent. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

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
  const revokeRateLimitResult =
    revokeSharingGrantLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!revokeRateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(revokeRateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many attempts. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

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
