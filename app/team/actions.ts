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
  deactivateMember,
  reactivateMember,
  removeMember,
} from "../../src/application/organizations/manage-membership";

import {
  inviteMember,
  revokeInvitation,
} from "../../src/application/organizations/invitations";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../components/shell/get-client-ip";

import type {
  TeamActionState,
} from "./action-state";

/**
 * 2026-08-29 (P11 mandatory security review, N4, SHOULD-FIX): master
 * plan §28 names "auth, mutation, import, and sharing endpoints" for
 * rate limiting -- inviteMemberAction was unbounded despite each call
 * sending a REAL email, via the service-role admin client
 * (getSupabaseAdminClient), to an attacker-chosen address. Combined
 * with getAppOrigin()'s own finding #12 (an attacker-controlled link
 * host in that same email, now allowlisted above), an unbounded
 * inviteMemberAction was unmetered, product-branded phishing/spam
 * capacity on this project's own sending reputation. Keyed by caller
 * IP (same pattern as every other limiter in this codebase) --
 * inviteMemberAction always has an authenticated, org-scoped caller
 * (getCurrentOrgSummary already gates it), but IP is still the right
 * key: a single compromised/malicious account inviting thousands of
 * addresses per minute is exactly what this bounds, and there is no
 * enumeration-avoidance reason (unlike signInAction) to prefer a
 * different key here.
 */
const INVITE_MEMBER_RATE_LIMIT: RateLimitConfig =
  {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  };

const inviteMemberLimiter =
  createInMemoryRateLimiter(
    INVITE_MEMBER_RATE_LIMIT,
  );

/**
 * 2026-08-30 (P13 final non-blocked-work audit, missing-rate-limit,
 * confirmed via adversarial verify): changeRoleAction,
 * removeMemberAction, deactivateMemberAction, reactivateMemberAction,
 * and revokeInvitationAction were unbounded despite the S17
 * remediation (commit 14c7c3f) citing this file as an example of "the
 * pattern already established" -- that was only ever true for
 * inviteMemberAction above. An authenticated ADMIN/OWNER session
 * (including one obtained via a stolen/leaked cookie) could otherwise
 * script an unbounded tight loop of these calls -- e.g. churning
 * deactivate/reactivate or role changes on the same membership --
 * producing unmetered writes and unmetered audit rows on every call
 * (manage-membership.ts's own audit trail), flooding the audit log.
 * Same 30/10min shape as the direct sibling in this codebase,
 * revokeSharingGrantAction (app/(producer)/sharing/actions.ts) --
 * these five actions are the same "mutate/revoke a relationship,
 * ADMIN+ only" risk class. Keyed by caller IP, same pattern as every
 * other limiter in this codebase.
 */
const MEMBERSHIP_MUTATION_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const changeRoleLimiter =
  createInMemoryRateLimiter(
    MEMBERSHIP_MUTATION_RATE_LIMIT,
  );

const removeMemberLimiter =
  createInMemoryRateLimiter(
    MEMBERSHIP_MUTATION_RATE_LIMIT,
  );

const deactivateMemberLimiter =
  createInMemoryRateLimiter(
    MEMBERSHIP_MUTATION_RATE_LIMIT,
  );

const reactivateMemberLimiter =
  createInMemoryRateLimiter(
    MEMBERSHIP_MUTATION_RATE_LIMIT,
  );

const revokeInvitationLimiter =
  createInMemoryRateLimiter(
    MEMBERSHIP_MUTATION_RATE_LIMIT,
  );

function tooManyAttemptsResult(
  retryAfterMs: number,
): TeamActionState {
  const retryAfterSeconds =
    Math.ceil(retryAfterMs / 1000);

  return {
    status: "error",
    message:
      `Too many attempts. Try again in ${retryAfterSeconds} ` +
      `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
  };
}

function messageFor(
  reason: string,
): string {
  switch (reason) {
    case "LAST_OWNER":
      return "This organization must always have at least one OWNER.";

    case "ONLY_OWNER_CAN_GRANT_OWNERSHIP":
      return "Only an OWNER can grant OWNER to another member.";

    case "MEMBERSHIP_NOT_FOUND":
      return "That member no longer exists.";

    case "ALREADY_DEACTIVATED":
      return "That member has already been deactivated.";

    case "NOT_DEACTIVATED":
      return "That member is already active.";

    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Only these host shapes are trusted when no APP_URL override is set
 * -- local dev, matching supabase/config.toml's own
 * `additional_redirect_urls` allowlist (http(s)://127.0.0.1:3000,
 * http(s)://localhost:3000) exactly. Anything else falls back to
 * FALLBACK_APP_ORIGIN below rather than being trusted verbatim -- see
 * this file's own 2026-08-29 comment for why.
 */
const TRUSTED_LOCAL_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1)(:\d+)?$/;

const FALLBACK_APP_ORIGIN =
  "http://localhost:3000";

/**
 * The origin used to build the invite email's redirect URL.
 *
 * 2026-08-29 (P11 mandatory security review, finding #12, SHOULD-FIX,
 * confirmed live): this function previously trusted
 * `x-forwarded-host`/`host` UNCONDITIONALLY, with no allowlist -- an
 * ADMIN of any throwaway org could invite a real person while sending
 * `X-Forwarded-Host: attacker.example`, and the victim's invite email
 * would carry a link to that host. The only backstop was Supabase
 * Auth's own `additional_redirect_urls` allowlist, which is hosted-
 * project configuration this repo cannot enforce or observe from
 * here (and, per this project's own operating constraints, no
 * Railway/staging Supabase is connected to this environment to even
 * check it against).
 *
 * The real, durable fix is an authoritative APP_URL env var, set once
 * this app's environment matrix is resolved (master plan §41, still
 * an open owner decision, honestly deferred here rather than invented
 * -- see docs/plans/MASTER_PLAN.md §41). This function already
 * prefers it, unconditionally, whenever it is set. Until then (this
 * environment, and every environment today, since APP_URL is not yet
 * set anywhere), request headers are still used to keep local dev
 * working exactly as before -- but ONLY when the host matches
 * TRUSTED_LOCAL_HOST_PATTERN; anything else (an attacker-supplied
 * `x-forwarded-host`, or a genuine unknown production domain this
 * function has no way to distinguish from a spoofed one without
 * APP_URL) falls back to FALLBACK_APP_ORIGIN instead of being trusted
 * verbatim. This closes the live-reproduced exploit today; setting a
 * real APP_URL is still required once a production domain exists --
 * that step is deliberately not fabricated as already done here.
 */
export async function getAppOrigin(): Promise<string> {
  const configuredAppUrl =
    process.env.APP_URL;

  if (configuredAppUrl) {
    return configuredAppUrl.replace(/\/+$/, "");
  }

  const headerList =
    await headers();

  const host =
    headerList.get(
      "x-forwarded-host",
    ) ?? headerList.get(
      "host",
    ) ?? "localhost:3000";

  if (!TRUSTED_LOCAL_HOST_PATTERN.test(host)) {
    return FALLBACK_APP_ORIGIN;
  }

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
  const rateLimitResult =
    changeRoleLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return tooManyAttemptsResult(
      rateLimitResult.retryAfterMs,
    );
  }

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
      await getPreferredOrgId(),
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
      orgSummary.context,
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
  const rateLimitResult =
    removeMemberLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return tooManyAttemptsResult(
      rateLimitResult.retryAfterMs,
    );
  }

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
      await getPreferredOrgId(),
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

const deactivateMemberSchema =
  z.object({
    membershipId:
      z.string().min(1),
  });

/**
 * Offboarding path -- see deactivateMember's own doc comment
 * (manage-membership.ts) for why this preserves the row instead of
 * deleting it. Same fetch-invariant-persist-audit shape and the same
 * REJECTED/messageFor handling as changeRoleAction/removeMemberAction
 * above, including LAST_OWNER: deactivating an org's last active OWNER
 * is refused for the same reason removing one is (isLastActiveOwner,
 * src/domain/organizations/invariants.ts).
 */
export async function deactivateMemberAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const rateLimitResult =
    deactivateMemberLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return tooManyAttemptsResult(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    deactivateMemberSchema.safeParse(
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
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You are not a member of an organization.",
    };
  }

  const result =
    await deactivateMember(
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

const reactivateMemberSchema =
  z.object({
    membershipId:
      z.string().min(1),
  });

/**
 * Reverse of deactivateMemberAction -- see reactivateMember's own doc
 * comment (manage-membership.ts). No LAST_OWNER case reachable here
 * (reactivation only ever adds an active owner back), but NOT_DEACTIVATED
 * is: a second reactivate submitted from a stale row (e.g. two admin
 * tabs open on the same member) is rejected rather than silently
 * treated as a no-op.
 */
export async function reactivateMemberAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const rateLimitResult =
    reactivateMemberLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return tooManyAttemptsResult(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    reactivateMemberSchema.safeParse(
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
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You are not a member of an organization.",
    };
  }

  const result =
    await reactivateMember(
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
  const inviteMemberRateLimitResult =
    inviteMemberLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!inviteMemberRateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(inviteMemberRateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many invitations sent. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

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
      await getPreferredOrgId(),
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

    // 2026-09-03 (P14): reported identically to the admin. The invitee
    // received a magic link instead of a provisioning invitation because
    // they already have an account -- an implementation detail from the
    // admin's point of view, and one whose disclosure would tell an
    // admin whether an arbitrary address is registered here.
    case "OK_MAGIC_LINK_SENT":
      return {
        status: "idle",
      };

    case "OK_EMAIL_NOT_SENT":
      return {
        status: "error",
        message:
          "The invitation was created, but the email couldn't be sent " +
          "right now. Try again in a minute, or ask them to sign in and " +
          "open Pending invitations from the menu.",
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
  const rateLimitResult =
    revokeInvitationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return tooManyAttemptsResult(
      rateLimitResult.retryAfterMs,
    );
  }

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

  // 2026-09-03 (P14, F5): revoking now takes an OrgContext, so it can
  // check the caller's role, pin the write to the ACTIVE organization
  // rather than any org RLS would admit, and attribute the audit event
  // it now writes.
  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return {
      status: "error",
      message: "You are not a member of an organization.",
    };
  }

  const result =
    await revokeInvitation(
      supabase,
      orgSummary.context,
      parsed.data.invitationId as never,
    );

  if (result.status === "PERMISSION_DENIED") {
    return {
      status: "error",
      message: "Only an ADMIN or OWNER can revoke an invitation.",
    };
  }

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
