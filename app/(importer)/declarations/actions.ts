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
  generateOrRefreshDeclarationDraft,
} from "../../../src/application/declarations/generate-or-refresh-declaration-draft";

import {
  markDeclarationReady,
} from "../../../src/application/declarations/mark-declaration-ready";

import {
  recordDeclarationFiled,
} from "../../../src/application/declarations/record-declaration-filed";

import {
  createDeclarationAmendment,
} from "../../../src/application/declarations/create-declaration-amendment";

import {
  parsePeriodParams,
} from "../../../src/application/reporting/parse-period-params";

import type {
  DeclarationActionState,
} from "./action-state";

function draftMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "PERMISSION_DENIED":
      return "Declaration preparation requires ADMIN or OWNER access.";

    case "PERIOD_HAS_READY_DECLARATION":
      return "A declaration for this period is already marked READY. Reopen it, or wait for it to be filed, before starting a new one.";

    case "PERIOD_ALREADY_FILED":
      return "This period already has a filed declaration. Create an amendment from that declaration instead of starting a new one.";

    case "CONCURRENT_MODIFICATION":
      return "This declaration changed elsewhere while this request was in flight. Reload and try again.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const INCOMPLETE_MESSAGE =
  "This declaration isn't complete yet -- see the named blockers below.";

function readyMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "PERMISSION_DENIED":
      return "Declaration preparation requires ADMIN or OWNER access.";

    case "NOT_FOUND":
      return "That declaration could not be found.";

    case "NOT_DRAFT":
      return "This declaration is no longer in DRAFT -- reload the page.";

    case "INCOMPLETE":
      return INCOMPLETE_MESSAGE;

    case "CONCURRENT_MODIFICATION":
      return "This declaration changed elsewhere while this request was in flight. Reload and try again.";

    default:
      return "Something went wrong. Please try again.";
  }
}

function filedMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "PERMISSION_DENIED":
    case "NOT_ADMIN":
      return "Recording a filing requires ADMIN or OWNER access.";

    case "EMPTY_FILED_REFERENCE":
      return "Enter the filing reference exactly as it appears on the declarant's own official-channel confirmation -- this field can't be blank.";

    case "NOT_FOUND":
      return "That declaration could not be found.";

    case "ALREADY_FILED":
      return "This declaration has already been recorded as filed.";

    case "NOT_READY":
      return "Mark this declaration READY before recording it as filed.";

    case "NO_MEMBER_SHIPMENTS":
      return "This declaration has no member shipments to lock.";

    case "SHIPMENTS_NOT_LOCKABLE":
      return "One or more member shipments are no longer READY or LOCKED -- refresh the draft and re-check ready.";

    case "INCOMPLETE":
      return "A fresh re-check at filing time found a member line with no calculation result -- refresh the draft and re-check ready.";

    default:
      return "Something went wrong recording this filing. Please try again.";
  }
}

function amendmentMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "PERMISSION_DENIED":
      return "Creating an amendment requires ADMIN or OWNER access.";

    case "NOT_FOUND":
      return "That declaration could not be found.";

    case "ORIGINAL_NOT_FILED":
      return "Only a filed declaration can be amended.";

    case "ALREADY_AMENDED":
      return "This declaration already has an active amendment.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const startDeclarationSchema =
  z.object({
    year:
      z.string().min(1),

    quarter:
      z.string().optional(),
  });

/**
 * The list screen's "Start declaration" entry point -- parses the same
 * `year`/`quarter` shape parsePeriodParams already owns (Reports screen
 * precedent) into a ReportingPeriod, then defers entirely to
 * generateOrRefreshDeclarationDraft (find-or-create + a fresh
 * completeness computation) rather than inserting a bare row here.
 * Redirects straight to the new/existing draft's detail page on
 * success, matching this codebase's "the mutation navigates you to
 * where its result lives" convention (createShipmentAction's own
 * redirect-on-success, app/(importer)/shipments/new/page.tsx).
 */
export async function startDeclarationAction(
  _previousState: DeclarationActionState,
  formData: FormData,
): Promise<DeclarationActionState> {
  const parsed =
    startDeclarationSchema.safeParse(
      {
        year: formData.get("year"),
        quarter: formData.get("quarter") ?? undefined,
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid 4-digit year.",
    };
  }

  const period =
    parsePeriodParams(
      {
        year: parsed.data.year,
        quarter: parsed.data.quarter,
      },
    );

  if (!period) {
    return {
      status: "error",
      message: "Enter a valid 4-digit year and, if quarterly, a quarter from 1-4.",
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
    await generateOrRefreshDeclarationDraft(
      supabase,
      orgSummary.context,
      period,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: draftMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/declarations",
  );

  redirect(
    `/declarations/${result.declaration.id}`,
  );
}

const declarationIdSchema =
  z.object({
    declarationId:
      z.string().min(1),
  });

const refreshDeclarationSchema =
  declarationIdSchema.extend(
    {
      year:
        z.string().min(1),

      quarter:
        z.string().optional(),
    },
  );

/**
 * The detail screen's "Generate/Refresh" action -- takes the
 * declaration's OWN reporting period (hidden fields on the form,
 * carried from the already-loaded declaration) rather than a
 * declarationId, since generateOrRefreshDeclarationDraft's own contract
 * is "find or create the DRAFT for this (org, period)," identical to
 * the list screen's startDeclarationAction. `declarationId` is accepted
 * only for the revalidatePath target below, not passed to the service
 * call itself.
 */
export async function refreshDeclarationDraftAction(
  _previousState: DeclarationActionState,
  formData: FormData,
): Promise<DeclarationActionState> {
  const parsed =
    refreshDeclarationSchema.safeParse(
      {
        declarationId: formData.get("declarationId"),
        year: formData.get("year"),
        quarter: formData.get("quarter") ?? undefined,
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid request.",
    };
  }

  const period =
    parsePeriodParams(
      {
        year: parsed.data.year,
        quarter: parsed.data.quarter,
      },
    );

  if (!period) {
    return {
      status: "error",
      message: "This declaration's own reporting period is invalid -- contact support.",
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
    await generateOrRefreshDeclarationDraft(
      supabase,
      orgSummary.context,
      period,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: draftMessageFor(result.reason),
    };
  }

  revalidatePath(
    `/declarations/${result.declaration.id}`,
  );

  return {
    status: "idle",
  };
}

export async function markDeclarationReadyAction(
  _previousState: DeclarationActionState,
  formData: FormData,
): Promise<DeclarationActionState> {
  const parsed =
    declarationIdSchema.safeParse(
      {
        declarationId: formData.get("declarationId"),
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
    await markDeclarationReady(
      supabase,
      orgSummary.context,
      parsed.data.declarationId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: readyMessageFor(result.reason),
      blockers: result.completeness_report?.blockers,
    };
  }

  revalidatePath(
    `/declarations/${parsed.data.declarationId}`,
  );

  return {
    status: "idle",
  };
}

const recordFiledSchema =
  declarationIdSchema.extend(
    {
      filedReference:
        z.string().min(1),
    },
  );

/**
 * §27's own "record-filed w/ LOCK warning" screen note is the client
 * component's job (declaration-actions.tsx: a confirmation step before
 * this action ever submits) -- this action itself is a thin pass-through
 * to recordDeclarationFiled, which is where the actual LOCK + filing
 * atomically happen (public.record_declaration_filed(), 20260829330000).
 */
export async function recordDeclarationFiledAction(
  _previousState: DeclarationActionState,
  formData: FormData,
): Promise<DeclarationActionState> {
  const parsed =
    recordFiledSchema.safeParse(
      {
        declarationId: formData.get("declarationId"),
        filedReference: formData.get("filedReference"),
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter the filing reference.",
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
    await recordDeclarationFiled(
      supabase,
      orgSummary.context,
      parsed.data.declarationId as never,
      parsed.data.filedReference,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: filedMessageFor(result.reason),
    };
  }

  revalidatePath(
    `/declarations/${parsed.data.declarationId}`,
  );

  return {
    status: "idle",
  };
}

export async function createDeclarationAmendmentAction(
  _previousState: DeclarationActionState,
  formData: FormData,
): Promise<DeclarationActionState> {
  const parsed =
    z.object(
      {
        originalDeclarationId: z.string().min(1),
      },
    ).safeParse(
      {
        originalDeclarationId: formData.get("originalDeclarationId"),
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
    await createDeclarationAmendment(
      supabase,
      orgSummary.context,
      parsed.data.originalDeclarationId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: amendmentMessageFor(result.reason),
    };
  }

  revalidatePath(
    "/declarations",
  );

  redirect(
    `/declarations/${result.declaration.id}`,
  );
}
