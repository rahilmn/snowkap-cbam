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
  upsertDeclarationContext,
} from "../../../src/application/emissions/manage-declaration-context";

import {
  addPrecursor,
  removePrecursor,
} from "../../../src/application/emissions/manage-precursors";

import type {
  PrecursorProvenance,
} from "../../../src/domain/emissions/declaration-context-types";

import {
  EVIDENCE_INCOMPLETE_NOTICE,
} from "../../../src/domain/status-vocabulary/owner-sentences";

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
      return "This action requires the record to be pending internal review.";

    case "NOT_VERIFIED":
      return "This record must be approved in internal review before it can be activated.";

    // Enforces the owner's blocking-model directive (2026-08-28):
    // evidence completeness blocks review/activation, and the message
    // is persistent, not a one-time toast -- surfaced here as the
    // server-side source of truth for both verifyEmissionData and
    // activateEmissionData rejections (manage-emission-data.ts), in
    // addition to the client-side "Incomplete" panel
    // emission-data-list.tsx renders from the same live completeness
    // check. The exact wording was revised under v2.1.1 §3 Correction
    // B (the original said "...used as verified data"); both sites
    // import the same constant from the vocabulary module
    // (src/domain/status-vocabulary/owner-sentences.ts) so they can
    // never drift from each other.
    case "EVIDENCE_INCOMPLETE":
      return EVIDENCE_INCOMPLETE_NOTICE;

    case "REJECTION_REASON_REQUIRED":
      return "Enter a reason for rejecting this record.";

    case "PERMISSION_DENIED":
      return "Only an admin or owner can approve or reject emission data in internal review.";

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

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM producer/operator.";

    // 2026-09-07 (S5 review round 4, findings S5R4-GUID-B2/S5R4-EVID-01
    // -- the same bug found independently by two reviewers). This
    // reason is a permanent, by-design refusal (removeEvidenceFile's
    // own doc comment, upload-evidence.ts) -- retrying will never
    // succeed, so the generic "Please try again" actively misled the
    // user about why the removal failed. This string has never
    // appeared in this file's history before this fix, even though the
    // reason itself was introduced by a P13 finding well before S5.
    case "EMISSION_DATA_VERIFIED":
      return "This record has already completed internal review, so its evidence can no longer be removed. Discard the record and start a new one if it needs to change.";

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

// ------------------------------------------------------------
// S4 (producer/trust/sharing), v2.1.1: dossier context + precursors.
// Same 30/10min ordinary-MEMBER-mutation rate as the transitions/
// evidence-removal actions above -- editing declared context is the
// same consequence class, not a compliance decision like verify/
// reject.
// ------------------------------------------------------------

const DECLARATION_CONTEXT_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const upsertDeclarationContextLimiter =
  createInMemoryRateLimiter(
    DECLARATION_CONTEXT_RATE_LIMIT,
  );

const addPrecursorLimiter =
  createInMemoryRateLimiter(
    DECLARATION_CONTEXT_RATE_LIMIT,
  );

const removePrecursorLimiter =
  createInMemoryRateLimiter(
    DECLARATION_CONTEXT_RATE_LIMIT,
  );

function declarationContextMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM producer/operator or importer/declarant.";

    case "RECORD_NOT_FOUND":
      return "That record could not be found.";

    case "RECORD_LOCKED":
      return "This record's context is locked -- it can only be edited before the record is approved in internal review.";

    case "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARATION":
      return "Declare that a verifier report exists before describing it.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const upsertDeclarationContextSchema =
  z.object({
    emissionDataId:
      z.string().min(1),

    productionProcessDescription:
      z.string().optional(),

    usesPurchasedPrecursors:
      z.string().optional(),

    verifierReportDeclared:
      z.string().optional(),

    verifierReportDescription:
      z.string().optional(),
  });

export async function upsertDeclarationContextAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    upsertDeclarationContextLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    upsertDeclarationContextSchema.safeParse(
      {
        emissionDataId: formData.get("emissionDataId"),
        productionProcessDescription: formData.get("productionProcessDescription") ?? undefined,
        usesPurchasedPrecursors: formData.get("usesPurchasedPrecursors") ?? undefined,
        verifierReportDeclared: formData.get("verifierReportDeclared") ?? undefined,
        verifierReportDescription: formData.get("verifierReportDescription") ?? undefined,
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

  const verifierReportDeclared =
    parsed.data.verifierReportDeclared === "true";

  const rawDescription =
    parsed.data.verifierReportDescription?.trim();

  const result =
    await upsertDeclarationContext(
      setup.supabase,
      setup.orgSummary.context,
      {
        emissionDataId: parsed.data.emissionDataId as never,
        productionProcessDescription:
          parsed.data.productionProcessDescription?.trim() || null,
        usesPurchasedPrecursors:
          parsed.data.usesPurchasedPrecursors === "true",
        verifierReportDeclared,
        // A description typed and then left after un-checking the
        // declaration checkbox is dropped, never silently persisted
        // against a false flag (upsertDeclarationContext would reject
        // that combination outright, but this avoids relying on the
        // rejection path for what is really a form UX nicety).
        verifierReportDescription:
          verifierReportDeclared && rawDescription ? rawDescription : null,
      },
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: declarationContextMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}

function precursorMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM producer/operator or importer/declarant.";

    case "RECORD_NOT_FOUND":
    case "PRECURSOR_NOT_FOUND":
      return "That could not be found.";

    case "RECORD_LOCKED":
      return "This record's precursors are locked -- they can only be edited before the record is approved in internal review.";

    case "EMPTY_MATERIAL_DESCRIPTION":
      return "Describe the precursor material.";

    case "INVALID_DIRECT_SPECIFIC":
      return "Enter a valid direct specific emissions figure, or leave it blank.";

    case "INVALID_INDIRECT_SPECIFIC":
      return "Enter a valid indirect specific emissions figure, or leave it blank.";

    case "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARED_REPORT":
      return "Select \"Actual value, verifier report declared\" before describing the report.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const PRECURSOR_PROVENANCE_VALUES =
  ["ACTUAL_WITH_DECLARED_REPORT", "ACTUAL_NO_DECLARED_REPORT", "UNKNOWN"] as const;

const addPrecursorSchema =
  z.object({
    emissionDataId:
      z.string().min(1),

    materialDescription:
      z.string().min(1, "Describe the precursor material."),

    cnCode:
      z.string().optional(),

    sourceDescription:
      z.string().optional(),

    directSpecific:
      z.string().optional(),

    indirectSpecific:
      z.string().optional(),

    emissionUnit:
      z.string().optional(),

    provenance:
      z.enum(PRECURSOR_PROVENANCE_VALUES),

    verifierReportDescription:
      z.string().optional(),
  });

export async function addPrecursorAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    addPrecursorLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    addPrecursorSchema.safeParse(
      {
        emissionDataId: formData.get("emissionDataId"),
        materialDescription: formData.get("materialDescription"),
        cnCode: formData.get("cnCode") ?? undefined,
        sourceDescription: formData.get("sourceDescription") ?? undefined,
        directSpecific: formData.get("directSpecific") ?? undefined,
        indirectSpecific: formData.get("indirectSpecific") ?? undefined,
        emissionUnit: formData.get("emissionUnit") ?? undefined,
        provenance: formData.get("provenance"),
        verifierReportDescription: formData.get("verifierReportDescription") ?? undefined,
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Invalid request.",
    };
  }

  const setup =
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const provenance: PrecursorProvenance =
    parsed.data.provenance;

  const rawDescription =
    parsed.data.verifierReportDescription?.trim();

  const result =
    await addPrecursor(
      setup.supabase,
      setup.orgSummary.context,
      {
        emissionDataId: parsed.data.emissionDataId as never,
        materialDescription: parsed.data.materialDescription.trim(),
        cnCode: parsed.data.cnCode?.trim() || null,
        sourceDescription: parsed.data.sourceDescription?.trim() || null,
        directSpecific: parsed.data.directSpecific?.trim() || null,
        indirectSpecific: parsed.data.indirectSpecific?.trim() || null,
        emissionUnit: parsed.data.emissionUnit?.trim() || null,
        provenance,
        verifierReportDescription:
          provenance === "ACTUAL_WITH_DECLARED_REPORT" && rawDescription
            ? rawDescription
            : null,
      },
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: precursorMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}

const removePrecursorSchema =
  z.object({
    precursorId:
      z.string().min(1),
  });

export async function removePrecursorAction(
  _previousState: EmissionDataScreenActionState,
  formData: FormData,
): Promise<EmissionDataScreenActionState> {
  const rateLimitResult =
    removePrecursorLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    removePrecursorSchema.safeParse(
      {
        precursorId: formData.get("precursorId"),
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
    await removePrecursor(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.precursorId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: precursorMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/emission-data",
  );

  return {
    status: "idle",
  };
}
