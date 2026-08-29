"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import { redirect } from "next/navigation";

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
  activateEmissionData,
  discardEmissionData,
  recordEmissionData,
  rejectEmissionData,
  submitForVerification,
  verifyEmissionData,
} from "../../../src/application/emissions/manage-emission-data";

import {
  removeEvidenceFile,
} from "../../../src/application/evidence/upload-evidence";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import type {
  ReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

import type {
  EmissionDataScreenActionState,
} from "./action-state";

function rateLimitedState(
  retryAfterMs: number,
): EmissionDataScreenActionState {
  const retryAfterSeconds =
    Math.ceil(retryAfterMs / 1000);

  return {
    status: "error",
    message:
      `Too many requests. Try again in ${retryAfterSeconds} ` +
      `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
  };
}

/**
 * A plain per-record create a legitimate producer can reasonably do
 * many times in one session (entering emission data for several
 * installations/CN-code scopes) -- generous, matching
 * createShipmentAction's/createSupplierAction's own 60/10min for the
 * same "ordinary bulk data entry" reasoning.
 */
const RECORD_EMISSION_DATA_RATE_LIMIT: RateLimitConfig =
  {
    limit: 60,
    windowMs: 10 * 60 * 1000,
  };

const recordEmissionDataLimiter =
  createInMemoryRateLimiter(
    RECORD_EMISSION_DATA_RATE_LIMIT,
  );

/**
 * SUBMIT_FOR_VERIFICATION/ACTIVATE/DISCARD are ordinary lifecycle
 * transitions a MEMBER can trigger -- real state changes, but routine
 * ones a user may click through for several records while working a
 * queue. Tighter than a plain create, looser than the ADMIN+-gated
 * verify/reject actions below (which carry compliance weight this
 * doesn't).
 */
const TRANSITION_EMISSION_DATA_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const transitionEmissionDataLimiter =
  createInMemoryRateLimiter(
    TRANSITION_EMISSION_DATA_RATE_LIMIT,
  );

/**
 * Removing an evidence file is undoing a mistaken upload -- rarer and
 * more consequential than the upload itself (already capped at
 * 20/5min, app/api/evidence/upload/route.ts), but a producer
 * correcting several wrong attachments while assembling a record's
 * evidence should not be blocked. Same 30/10min as the ordinary
 * lifecycle transitions above.
 */
const REMOVE_EVIDENCE_FILE_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const removeEvidenceFileLimiter =
  createInMemoryRateLimiter(
    REMOVE_EVIDENCE_FILE_RATE_LIMIT,
  );

/**
 * verifyEmissionDataAction/rejectEmissionDataAction are ADMIN+-only
 * compliance decisions (manage-emission-data.ts's own hasAdminAccess
 * gate) -- the same "state-transition with real consequences" category
 * as declarations' markDeclarationReadyAction, tighter than the
 * ordinary MEMBER-level transitions above.
 */
const VERIFY_EMISSION_DATA_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const verifyEmissionDataLimiter =
  createInMemoryRateLimiter(
    VERIFY_EMISSION_DATA_RATE_LIMIT,
  );

const rejectEmissionDataLimiter =
  createInMemoryRateLimiter(
    VERIFY_EMISSION_DATA_RATE_LIMIT,
  );

async function requireOrgAndUser() {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  return {
    status: "ok" as const,
    supabase,
    orgSummary,
    user,
  };
}

function recordMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "EMPTY_CN_SCOPE":
      return "Enter at least one CN code.";

    case "INVALID_DIRECT_SPECIFIC":
      return "Enter a valid direct specific emissions value.";

    case "INVALID_INDIRECT_SPECIFIC":
      return "Enter a valid indirect specific emissions value.";

    case "INSTALLATION_NOT_FOUND":
      return "Choose a valid installation.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM producer/operator.";

    default:
      return "Something went wrong. Please try again.";
  }
}

function transitionMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "RECORD_NOT_DRAFT":
      return "This action requires the record to be in draft.";

    case "VERIFICATION_NOT_PENDING":
      return "This action requires the record to be pending verification.";

    case "NOT_VERIFIED":
      return "This record must be verified before it can be activated.";

    // Exact copy required by the owner's blocking-model directive
    // (2026-08-28) -- surfaced here as the server-side source of truth
    // for both verifyEmissionData and activateEmissionData rejections
    // (manage-emission-data.ts), in addition to the persistent
    // client-side "Incomplete" panel emission-data-list.tsx already
    // renders from the same live completeness check, so the message is
    // never only a one-time toast.
    case "EVIDENCE_INCOMPLETE":
      return "Additional evidence is required before these actual emissions can be used as verified data.";

    case "REJECTION_REASON_REQUIRED":
      return "Enter a reason for rejecting this record.";

    case "PERMISSION_DENIED":
      return "Only an admin or owner can verify or reject emission data.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM producer/operator.";

    case "NOT_FOUND":
      return "That record could not be found.";

    case "CONCURRENT_MODIFICATION":
      return "This record changed while you were viewing it -- reload and try again.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const recordEmissionDataSchema =
  z.object({
    installationId:
      z.string().min(1, "Choose an installation."),

    cnScope:
      z.string().min(1, "Enter at least one CN code."),

    periodKind:
      z.enum(["ANNUAL", "QUARTERLY"]),

    periodYear:
      z.string().min(1, "Enter a year."),

    periodQuarter:
      z.string().optional(),

    directSpecific:
      z.string().min(1, "Enter the direct specific emissions value."),

    indirectSpecific:
      z.string().min(1, "Enter the indirect specific emissions value."),

    emissionUnit:
      z.string().min(1, "Enter the emission unit."),

    methodology:
      z.enum(["EU_METHOD", "EQUIVALENT_METHOD", "OTHER"]),
  });

export async function recordEmissionDataAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    recordEmissionDataLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    recordEmissionDataSchema.safeParse(
      {
        installationId: formData.get("installationId"),
        cnScope: formData.get("cnScope"),
        periodKind: formData.get("periodKind"),
        periodYear: formData.get("periodYear"),
        periodQuarter: formData.get("periodQuarter") ?? undefined,
        directSpecific: formData.get("directSpecific"),
        indirectSpecific: formData.get("indirectSpecific"),
        emissionUnit: formData.get("emissionUnit"),
        methodology: formData.get("methodology"),
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

  const year =
    Number(
      parsed.data.periodYear,
    );

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return {
      status: "error",
      message: "Enter a valid reporting year.",
    };
  }

  let period: ReportingPeriod;

  if (parsed.data.periodKind === "QUARTERLY") {
    const quarter =
      Number(
        parsed.data.periodQuarter,
      );

    if (![1, 2, 3, 4].includes(quarter)) {
      return {
        status: "error",
        message: "Choose a quarter for a quarterly reporting period.",
      };
    }

    period = {
      kind: "QUARTERLY",
      year,
      quarter: quarter as 1 | 2 | 3 | 4,
    };
  } else {
    period = {
      kind: "ANNUAL",
      year,
    };
  }

  const cnScope =
    parsed.data.cnScope
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0);

  const setup =
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await recordEmissionData(
      setup.supabase,
      setup.orgSummary.context,
      {
        installationId: parsed.data.installationId as never,
        cnScope,
        period,
        directSpecific: parsed.data.directSpecific.trim(),
        indirectSpecific: parsed.data.indirectSpecific.trim(),
        emissionUnit: parsed.data.emissionUnit.trim(),
        methodology: parsed.data.methodology,
      },
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: recordMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}

const transitionSchema =
  z.object({
    emissionDataId:
      z.string().min(1),

    action:
      z.enum(["SUBMIT_FOR_VERIFICATION", "ACTIVATE", "DISCARD"]),
  });

/**
 * SUBMIT_FOR_VERIFICATION/ACTIVATE/DISCARD are ordinary MEMBER actions
 * -- no role check here, matching manage-emission-data.ts's own
 * signatures for these three (plain orgId/actorUserId, no OrgContext).
 * VERIFY/REJECT are handled by their own actions below, which DO
 * require OrgContext for the ADMIN+ gate.
 */
export async function transitionEmissionDataAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    transitionEmissionDataLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    transitionSchema.safeParse(
      {
        emissionDataId: formData.get("emissionDataId"),
        action: formData.get("action"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid request.",
    };
  }

  const setup =
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    parsed.data.action === "SUBMIT_FOR_VERIFICATION"
      ? await submitForVerification(
          setup.supabase,
          setup.orgSummary.context,
          parsed.data.emissionDataId as never,
        )
      : parsed.data.action === "ACTIVATE"
      ? await activateEmissionData(
          setup.supabase,
          setup.orgSummary.context,
          parsed.data.emissionDataId as never,
        )
      : await discardEmissionData(
          setup.supabase,
          setup.orgSummary.context,
          parsed.data.emissionDataId as never,
        );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: transitionMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}

const removeEvidenceFileSchema =
  z.object({
    evidenceFileId:
      z.string().min(1),
  });

function removeEvidenceFileMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "NOT_FOUND":
      return "That evidence file could not be found.";

    case "STORAGE_DELETE_FAILED":
      return "Could not remove the file from storage. Try again.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM producer/operator.";

    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Ordinary MEMBER action -- no role check, same posture as
 * transitionEmissionDataAction above (removing a wrongly-uploaded
 * evidence file is not an ADMIN+-gated action, unlike verify/reject).
 */
export async function removeEvidenceFileAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    removeEvidenceFileLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    removeEvidenceFileSchema.safeParse(
      {
        evidenceFileId: formData.get("evidenceFileId"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid request.",
    };
  }

  const setup =
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await removeEvidenceFile(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.evidenceFileId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: removeEvidenceFileMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}

const verifySchema =
  z.object({
    emissionDataId:
      z.string().min(1),
  });

/**
 * ADMIN+ only -- manage-emission-data.ts's verifyEmissionData checks
 * this itself via hasAdminAccess(context), so the full OrgContext (not
 * just orgId/actorUserId) is passed through here. See that function's
 * own doc comment for why this is the PRIMARY enforcement layer, with
 * a DB trigger as an independent backstop.
 */
export async function verifyEmissionDataAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    verifyEmissionDataLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    verifySchema.safeParse(
      {
        emissionDataId: formData.get("emissionDataId"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid request.",
    };
  }

  const setup =
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await verifyEmissionData(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.emissionDataId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: transitionMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}

const rejectSchema =
  z.object({
    emissionDataId:
      z.string().min(1),

    reason:
      z.string().min(1, "Enter a reason for rejecting this record."),
  });

export async function rejectEmissionDataAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    rejectEmissionDataLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    rejectSchema.safeParse(
      {
        emissionDataId: formData.get("emissionDataId"),
        reason: formData.get("reason"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Enter a reason for rejecting this record.",
    };
  }

  const setup =
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await rejectEmissionData(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.emissionDataId as never,
      parsed.data.reason.trim(),
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: transitionMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}
