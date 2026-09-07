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

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import type {
  DeclarationActionState,
} from "./action-state";

function rateLimitedState(
  retryAfterMs: number,
): DeclarationActionState {
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
 * startDeclarationAction/refreshDeclarationDraftAction both bottom out
 * in generateOrRefreshDeclarationDraft, which is the expensive call on
 * this screen -- it re-derives completeness across every member
 * shipment's own calculation result, not a single-row write. A real
 * user legitimately hits "Generate/Refresh" more than once per period
 * while iterating on shipment data, so this is more generous than the
 * filing/amendment actions below, but still well short of
 * createShipmentAction's 60/10min: each call is a heavier DB read/write
 * than a single-record create.
 */
const GENERATE_DRAFT_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const startDeclarationLimiter =
  createInMemoryRateLimiter(
    GENERATE_DRAFT_RATE_LIMIT,
  );

const refreshDeclarationDraftLimiter =
  createInMemoryRateLimiter(
    GENERATE_DRAFT_RATE_LIMIT,
  );

/**
 * markDeclarationReadyAction is a real state transition (DRAFT ->
 * READY) with downstream consequences (it's the gate before filing),
 * but a legitimate user can reasonably re-check readiness several
 * times while fixing named blockers one at a time -- tighter than a
 * plain create, looser than the one-shot filing/amendment actions
 * below.
 */
const MARK_READY_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const markDeclarationReadyLimiter =
  createInMemoryRateLimiter(
    MARK_READY_RATE_LIMIT,
  );

/**
 * recordDeclarationFiledAction atomically LOCKs every member shipment
 * and records an official, real-world filing reference
 * (record_declaration_filed()) -- this is the single most consequential
 * mutation on this screen and happens at most once (successfully) per
 * declaration. 10/10min is deliberately tight: no legitimate workflow
 * calls this more than a handful of times per session (typically once
 * per period, occasionally retried after fixing a validation error).
 */
const RECORD_FILED_RATE_LIMIT: RateLimitConfig =
  {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  };

const recordDeclarationFiledLimiter =
  createInMemoryRateLimiter(
    RECORD_FILED_RATE_LIMIT,
  );

/**
 * createDeclarationAmendmentAction creates a new, real declaration row
 * off an already-filed original -- an infrequent, deliberate action
 * (at most one active amendment per original, enforced by
 * ALREADY_AMENDED below) rather than something a user does repeatedly
 * in a session. Tighter than a plain create, looser than filing itself
 * since a user might reasonably retry after an ALREADY_AMENDED/
 * ORIGINAL_NOT_FILED rejection while finding the right declaration.
 */
const CREATE_AMENDMENT_RATE_LIMIT: RateLimitConfig =
  {
    limit: 15,
    windowMs: 10 * 60 * 1000,
  };

const createDeclarationAmendmentLimiter =
  createInMemoryRateLimiter(
    CREATE_AMENDMENT_RATE_LIMIT,
  );

function draftMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "PERMISSION_DENIED":
      return "Declaration preparation requires ADMIN or OWNER access.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

    // 2026-09-07 (S5 review round 6, finding S5R6-A-GUID3). "Reopen it"
    // used to name the declaration itself -- no control anywhere in
    // this product does that (DeclarationActions renders exactly
    // RecordFiledForm for a READY declaration and nothing else; its own
    // inline comment states outright there is no route back to draft
    // from that screen). The only real, live-reproduced mechanism is
    // app.invalidate_declaration_approval_on_reopen (20260905140000)
    // firing as a side effect of a MEMBER SHIPMENT's own status leaving
    // READY -- reopening any one of its member shipments, from that
    // shipment's own detail page, flips the whole declaration back to
    // DRAFT automatically. Genuinely reachable: any admin who clicks
    // "Start declaration" for a period that already has a READY
    // declaration hits this exact message.
    case "PERIOD_HAS_READY_DECLARATION":
      return "A declaration for this period is already approved for filing. To make changes to it, reopen one of its member shipments from that shipment's own detail page -- this automatically returns the declaration to draft -- or wait for it to be filed before starting a new one.";

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

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

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

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

    case "EMPTY_FILED_REFERENCE":
      return "Enter the filing reference exactly as it appears on the declarant's own official-channel confirmation -- this field can't be blank.";

    case "NOT_FOUND":
      return "That declaration could not be found.";

    case "ALREADY_FILED":
      return "This declaration has already been recorded as filed.";

    case "NOT_READY":
      return "Approve this declaration for filing before recording it as filed.";

    case "NO_MEMBER_SHIPMENTS":
      return "This declaration has no member shipments to lock.";

    case "SHIPMENTS_NOT_LOCKABLE":
      return "One or more member shipments are no longer READY or LOCKED -- refresh the draft and re-check ready.";

    case "INCOMPLETE":
      return "A fresh re-check at filing time found a member line with no calculation result -- refresh the draft and re-check ready.";

    // 2026-09-03 (P14 remediation, 20260903220000). Both messages name
    // the concrete next action, because both are recoverable states an
    // ordinary period edit can produce -- not errors.
    //
    // 2026-09-07 (S5 review round 7, finding S5R7-A-B2). This reason is
    // returned ONLY by record_declaration_filed(), reachable ONLY from
    // RecordFiledForm, rendered ONLY for a READY declaration -- and
    // DeclarationActions renders no OTHER control for READY, in
    // particular no "Generate / refresh draft" (that renders only for
    // DRAFT). "Refresh the draft" therefore named a control that is not
    // on the screen this message is shown on. The identical "Reopen the
    // declaration"/"Reopen it" gap round 6's own S5R6-A-GUID3 fixed
    // three commits earlier in this same switch statement, for the
    // three cases immediately above this one -- missed here because a
    // new shipment entering the period (this reason's own trigger) is
    // not a shipment REOPENING, so app.invalidate_declaration_approval_
    // on_reopen never fires and the declaration never becomes DRAFT on
    // its own. Reopening any one of its EXISTING member shipments still
    // works (it flips the whole declaration back to DRAFT, where
    // Generate/refresh becomes available, and a fresh regeneration then
    // picks up the new period shipment too) -- the same real mechanism
    // the three sibling cases above now name.
    //
    // 2026-09-07 (S5 review round 8, finding S5R8-A-B1). The instruction
    // above assumed at least one existing member shipment is still
    // READY (reopenable) -- but record_declaration_filed() itself
    // accepts READY *or* LOCKED members as "lockable" (20260906250000's
    // own comments call an all-LOCKED member set "the routine case for
    // an amendment"), and shipments_update_own_org_not_terminal's own
    // USING clause structurally excludes LOCKED from any UPDATE for
    // anyone, ADMIN/OWNER included -- live-confirmed via a real RLS
    // write attempt (`UPDATE 0` rows). An all-LOCKED amendment whose
    // period gains a new shipment reaches exactly this case with zero
    // reopenable members, and the old wording sent that reader to a
    // dead end. filedMessageFor only receives the bare reason string
    // (no per-shipment context), so this hedges in prose the same way
    // CALCULATION_ENGINE_OUTDATED/DATASET_SUPERSEDED below already do
    // for the identical LOCKED-vs-not distinction, rather than covering
    // only the READY case.
    case "MEMBERS_NOT_PERIOD_COMPLETE":
      return "The shipments in this declaration are no longer exactly the shipments in its reporting period -- one has moved period, or a new one has been added. If any of its existing member shipments has not been LOCKED, reopen it from that shipment's own detail page -- this returns the declaration to draft, where a fresh Generate/refresh will pick up the current period membership -- then approve it for filing again. If every existing member shipment has already been LOCKED (for example by an earlier filing -- the routine case for an amendment), this cannot be corrected through the normal declaration flow -- contact support.";

    case "SHIPMENT_ALREADY_FILED":
      return "One or more member shipments have already been recorded as filed on another declaration. If this is a correction, create an amendment of that declaration instead.";

    // 2026-09-04 (P14 owner decision 2). Names the action, because this
    // is a state ordinary work reaches -- a line calculated before an
    // engine release and filed after it -- not an error.
    //
    // 2026-09-06 (S5 review remediation, finding A2). The recalculate
    // instruction is only actually possible while the member shipment
    // is still editable (DRAFT) -- shipment_lines stays writable only
    // then (20260904090000), and a LOCKED shipment (this exact
    // declaration's own member, once it or an earlier version of it was
    // filed) has no reopen path back out of LOCKED either
    // (shipments_update_own_org_not_terminal excludes LOCKED). The old
    // wording asserted the fix would work unconditionally; it does not
    // say so when it cannot, per the same finding's own core complaint.
    //
    // 2026-09-07 (S5 review round 7, finding S5R7-A-B1). This reason is
    // returned ONLY by record_declaration_filed(), which only reaches
    // it after its own SHIPMENTS_NOT_LOCKABLE check has already
    // confirmed every member shipment is READY or LOCKED -- "still
    // editable" (DRAFT) can therefore NEVER be true at the exact moment
    // this message is shown, making the A2 wording above dead text for
    // the routine case (a first-time filing whose calculation just went
    // stale, member shipment READY, never locked) and giving that user
    // nothing to do. The real recovery for a READY (non-LOCKED)
    // shipment does NOT require reopening at all:
    // record_calculation_result (20260906210000) deliberately still
    // permits recalculating a READY line with a new engine version,
    // specifically so this recovery never needs the full reopen/
    // re-approve cycle -- app/(importer)/shipments/[id]/page.tsx's own
    // Recalculate control (canRecalculate) now matches that same
    // carve-out.
    case "CALCULATION_ENGINE_OUTDATED":
      return "One or more lines were calculated by an earlier version of the calculation engine. If the member shipment has not been LOCKED, recalculate those lines directly on the shipment's own detail page (no need to reopen it), then record the filing -- the earlier results are kept for provenance. If it has already been LOCKED (for example by an earlier filing), this cannot be corrected through the normal declaration flow -- contact support.";

    // 2026-09-06 (S5 finding #12, 20260906250000; messaging widened same
    // day, S5 review remediation finding A2). A default-value line was
    // determined against a regulatory dataset that has since been
    // corrected/superseded.
    //
    // 2026-09-07 (S5 review round 7, finding S5R7-A-B1). Same "still
    // editable (DRAFT) can never be true here" gap as
    // CALCULATION_ENGINE_OUTDATED above -- but UNLIKE that case,
    // redetermining a line genuinely does require reopening first:
    // redetermination writes shipment_lines.emission_determination,
    // which stays DRAFT-only (shipment_lines_update_parent_draft_only)
    // -- record_calculation_result's own READY carve-out is specific to
    // recalculation, not redetermination. Matches the already-correct
    // wording completeness-report-card.tsx's own sibling `stale` branch
    // uses for the identical READY-declaration state.
    case "DATASET_SUPERSEDED":
      return "One or more lines were determined against a regulatory dataset that has since been corrected. If the member shipment has not been LOCKED, reopen it, redetermine that line against the current dataset, then approve this declaration for filing again -- the earlier determination is kept for provenance. If it has already been LOCKED (for example by an earlier filing), this cannot be corrected through the normal declaration flow -- contact support.";

    // 2026-09-04 (P14). The lines are not the ones this declaration was
    // approved over. Recoverable, and the message says how: re-approving
    // the declaration is what records the new population as approved.
    // 2026-09-07 (S5 review round 6, finding S5R6-A-GUID3). Same
    // "Reopen the declaration"/"Reopen it" gap as PERIOD_HAS_READY_
    // DECLARATION above -- see that case's own comment for why no such
    // control exists and what the real mechanism is. This specific
    // state is effectively unreachable through the shipped product's
    // own UI/RLS-bound writes today (shipment_lines_update_parent_
    // draft_only + app.enforce_shipment_lines_parent_editable,
    // 20260904090000, block editing a READY shipment's lines outright,
    // so an ordinary reopen-then-edit already retires the approval
    // before this state could arise) -- corrected anyway, since the
    // wording is still wrong on the rare/internal path that does reach
    // it (an out-of-band write bypassing those triggers).
    case "POPULATION_CHANGED_SINCE_READY":
      return "The lines in this declaration's shipments have changed since it was approved for filing, so filing it now would record a different population than the one approved. Reopening any of its member shipments (from that shipment's own detail page) returns this declaration to draft so you can check the lines and approve it for filing again.";

    case "APPROVED_POPULATION_UNKNOWN":
      return "This declaration has no record of the line population it was approved over, so filing cannot confirm the two match. Reopening any of its member shipments (from that shipment's own detail page) returns this declaration to draft so you can approve it for filing again.";

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

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

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
  const rateLimitResult =
    startDeclarationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

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

  // 2026-09-06 (S5 cross-phase hardening). computeDeclarationDraftFacts
  // (called by generateOrRefreshDeclarationDraft) now THROWS on a
  // genuine infrastructure failure reading the period's shipments/lines
  // -- it used to fail closed to an empty, fabricated "no shipments"
  // fact set instead. Caught here and turned into the same expected
  // {status:"error"} shape this action already returns for a REJECTED
  // outcome, rather than letting an unhandled throw reach the client as
  // an unstyled error from inside a Server Action.
  let result:
    Awaited<ReturnType<typeof generateOrRefreshDeclarationDraft>>;

  try {
    result =
      await generateOrRefreshDeclarationDraft(
        supabase,
        orgSummary.context,
        period,
      );
  } catch {
    return {
      status: "error",
      message: "Couldn't load this period's shipments right now. Try again.",
    };
  }

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
  const rateLimitResult =
    refreshDeclarationDraftLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

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

  // See the identical S5 hardening note on generateDeclarationDraftAction
  // above.
  let result:
    Awaited<ReturnType<typeof generateOrRefreshDeclarationDraft>>;

  try {
    result =
      await generateOrRefreshDeclarationDraft(
        supabase,
        orgSummary.context,
        period,
      );
  } catch {
    return {
      status: "error",
      message: "Couldn't load this period's shipments right now. Try again.",
    };
  }

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
  const rateLimitResult =
    markDeclarationReadyLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

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

  // See the identical S5 hardening note on generateDeclarationDraftAction
  // above -- markDeclarationReady also calls computeDeclarationDraftFacts.
  let result:
    Awaited<ReturnType<typeof markDeclarationReady>>;

  try {
    result =
      await markDeclarationReady(
        supabase,
        orgSummary.context,
        parsed.data.declarationId as never,
      );
  } catch {
    return {
      status: "error",
      message: "Couldn't check this declaration's completeness right now. Try again.",
    };
  }

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
  const rateLimitResult =
    recordDeclarationFiledLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

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
  const rateLimitResult =
    createDeclarationAmendmentLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

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
