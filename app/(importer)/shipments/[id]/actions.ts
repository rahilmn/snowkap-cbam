"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../components/shell/get-preferred-org-id";

import {
  getRegulatoryCountryMapper,
  getRegulatoryRepository,
} from "../../../../src/infrastructure/regulatory/get-regulatory-repository";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../../components/shell/get-client-ip";

import {
  addLine,
  removeLine,
} from "../../../../src/application/shipments/manage-lines";

import {
  transitionShipmentStatus,
} from "../../../../src/application/shipments/transition-shipment";

import {
  determineLineEmissions,
  redetermineLineEmissions,
} from "../../../../src/application/emissions/resolve-line-emissions";

import {
  determineLineFromActualData,
  redetermineLineFromActualData,
} from "../../../../src/application/emissions/determine-from-actual-data";

import {
  calculateLine,
} from "../../../../src/application/calculations/calculate-line";

import {
  reproduceCalculationResult,
} from "../../../../src/application/calculations/reproduce-calculation-result";

import type {
  ShipmentTransitionAction,
} from "../../../../src/domain/shipments/lifecycle";

import type {
  LineActionState,
} from "./action-state";

import type {
  ResolveEmissionsActionState,
} from "./resolve-emissions-action-state";

import type {
  ReproductionActionState,
} from "./reproduction-action-state";

function lineMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "INVALID_CN_CODE_FORMAT":
      return "Enter a valid 8-digit CN or 10-digit TARIC code.";

    case "UNSUPPORTED_CODE":
      return "That code isn't a CBAM good.";

    case "AMBIGUOUS_CODE":
      return "That code matches more than one CBAM good and needs to be disambiguated.";

    case "QUANTITY_UNIT_MISMATCH":
      return "This good requires a different quantity unit than the one entered.";

    case "ROUTE_NOT_FOUND":
      return "That production route wasn't found for this good's sector.";

    case "ROUTE_AMBIGUOUS":
      return "That production route name matches more than one route.";

    case "INVALID_QUANTITY":
      return "Enter a valid, positive quantity.";

    case "INVALID_ORIGIN_COUNTRY":
      return "Enter a valid 2-letter origin country code (e.g. DE, CN).";

    case "SHIPMENT_NOT_FOUND":
      return "That shipment could not be found.";

    case "SHIPMENT_NOT_EDITABLE":
      return "This shipment is locked or void and can no longer be edited.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

    default:
      return "Something went wrong. Please try again.";
  }
}

function resolveEmissionsRejectionMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "LINE_NOT_FOUND":
      return "That line could not be found.";

    case "SHIPMENT_NOT_EDITABLE":
      return "This shipment is locked or void and can no longer be edited.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const UNRESOLVED_REASON_MESSAGES: Record<string, string> = {
  REFERENCE_REQUIRED:
    "The regulatory dataset requires a further reference for this exact combination -- it cannot be resolved automatically.",

  UNAVAILABLE:
    "The regulatory dataset has a record for this combination, but no usable emissions value.",

  NOT_APPLICABLE:
    "The regulatory dataset marks this combination as not applicable.",

  AMBIGUOUS:
    "More than one usable regulatory record matches this combination -- a production route may need to be specified.",

  NO_MATCH:
    "No regulatory default value exists for this combination, including the Other Countries and Territories fallback.",
};

function unresolvedMessageFor(
  reason: string,
): string {
  return (
    UNRESOLVED_REASON_MESSAGES[reason] ??
    "This line's emissions could not be determined."
  );
}

function calculationStatusMessageFor(
  status: string,
): string {
  switch (status) {
    case "INPUT_UNRESOLVED":
      return "Determine this line's emissions before calculating.";

    case "VALUE_UNAVAILABLE":
      return "The resolved value isn't usable for calculation.";

    case "UNIT_UNSUPPORTED":
      return "The resolved emission unit doesn't match this line's quantity -- this needs review before it can be calculated.";

    case "PARAMETER_DATASET_UNAVAILABLE":
      return "This good may be subject to the EU CBAM's direct-emissions-only rule for iron & steel and aluminium (Annex II), and Snowkap does not yet have the reference data needed to apply that rule automatically. This is a known platform limitation, not an issue with your data -- calculation is unavailable until that reference data is added.";

    default:
      return "This line could not be calculated.";
  }
}

function transitionMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "NO_LINES":
      return "Add at least one line before marking this shipment ready.";

    case "LINE_INCOMPLETE":
      return "Every line needs a resolved emission determination before this shipment can be marked ready.";

    case "SHIPMENT_NOT_DRAFT":
      return "This action requires the shipment to be in draft.";

    case "SHIPMENT_NOT_READY":
      return "This action requires the shipment to be ready.";

    case "SHIPMENT_ALREADY_LOCKED":
      return "This shipment is already locked.";

    case "SHIPMENT_ALREADY_VOID":
      return "This shipment is already void.";

    case "NOT_FOUND":
      return "That shipment could not be found.";

    case "PERMISSION_DENIED":
      return "Only an ADMIN or OWNER can lock a shipment.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const addLineSchema =
  z.object({
    shipmentId:
      z.string().min(1),

    cnCode:
      z.string().min(1),

    goodsDescription:
      z.string().optional(),

    originCountry:
      z.string().min(1),

    quantityKind:
      z.enum(["MASS", "ENERGY"]),

    quantityValue:
      z.string().min(1),

    productionRouteName:
      z.string().optional(),
  });

// 2026-08-29 (P13 audit finding, live-reproduced): searchCbamGoodsAction
// is a real Server Action -- a directly-invokable POST endpoint
// (framework Next-Action header) independent of whether the React page
// around it ever renders, exactly the pitfall Next's own docs name
// ("render-time gating ... is not a security boundary, because
// requests can be sent without going through the UI"). This file's own
// prior comment claimed "the app's own auth-gated routing already
// keeps a signed-out visitor from reaching the page" -- false:
// proxy.ts (this app's only middleware) never checks auth or redirects
// unauthenticated requests, it only refreshes the session cookie and
// always calls NextResponse.next(). searchCbamGoodsByText also runs
// through the service-role client (bypasses RLS entirely, the same
// protected-zone client ADR-0005 restricts to system jobs), so the
// intended authenticated-only access policy for cbam_goods was
// bypassed by construction, not merely unenforced. 20 req/10s/IP is
// deliberately generous (this backs live-as-you-type search) while
// still bounding an unauthenticated replay loop.
const SEARCH_CBAM_GOODS_RATE_LIMIT: RateLimitConfig =
  {
    limit: 20,
    windowMs: 10 * 1000,
  };

const searchCbamGoodsLimiter =
  createInMemoryRateLimiter(
    SEARCH_CBAM_GOODS_RATE_LIMIT,
  );

/**
 * Live-search backing for the CN/TARIC classification combobox
 * (cn-code-picker.tsx) -- read-only against the public regulatory
 * cbam_goods reference data (already readable by any authenticated
 * user via authenticated_read_regulatory_data's own SELECT policies,
 * 20260828100000). Gated on genuine authentication (not org
 * membership specifically -- there is no org-scoped data here to
 * leak, only a real signed-in session) plus a rate limit, per the
 * 2026-08-29 finding above. Returns the canonical cbam_goods rows
 * verbatim (searchCbamGoodsByText, src/infrastructure/regulatory/
 * supabase-regulatory-repository.ts) -- never a synthesized or
 * invented candidate. A short/blank query returns [] without a DB
 * round trip, matching that method's own guard.
 */
export async function searchCbamGoodsAction(
  query: string,
): Promise<{ trade_code: string; trade_code_type: string; description: string }[]> {
  const rateLimitResult =
    searchCbamGoodsLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return [];
  }

  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  if (query.trim().length < 2) {
    return [];
  }

  const results =
    await getRegulatoryRepository().searchCbamGoodsByText(
      query,
      20,
    );

  return results.map(
    (good) => (
      {
        trade_code: good.trade_code,
        trade_code_type: good.trade_code_type,
        description: good.description,
      }
    ),
  );
}

export async function addLineAction(
  _previousState: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const parsed =
    addLineSchema.safeParse(
      {
        shipmentId: formData.get("shipmentId"),
        cnCode: formData.get("cnCode"),
        goodsDescription: formData.get("goodsDescription") ?? undefined,
        originCountry: formData.get("originCountry"),
        quantityKind: formData.get("quantityKind"),
        quantityValue: formData.get("quantityValue"),
        productionRouteName: formData.get("productionRouteName") ?? undefined,
      },
    );

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the form and try again.",
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const result =
    await addLine(
      supabase,
      getRegulatoryRepository(),
      orgSummary.context,
      parsed.data.shipmentId as never,
      {
        cnCode: parsed.data.cnCode.trim(),
        goodsDescription: parsed.data.goodsDescription?.trim() || null,
        originCountry: parsed.data.originCountry.trim().toUpperCase(),
        quantity: {
          kind: parsed.data.quantityKind,
          value: parsed.data.quantityValue.trim(),
        },
        productionRouteName: parsed.data.productionRouteName?.trim() || null,
      },
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: lineMessageFor(result.reason),
    };
  }

  revalidatePath(
    `/shipments/${parsed.data.shipmentId}`,
  );

  return {
    status: "idle",
  };
}

const removeLineSchema =
  z.object({
    lineId:
      z.string().min(1),

    shipmentId:
      z.string().min(1),
  });

export async function removeLineAction(
  _previousState: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const parsed =
    removeLineSchema.safeParse(
      {
        lineId: formData.get("lineId"),
        shipmentId: formData.get("shipmentId"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const result =
    await removeLine(
      supabase,
      orgSummary.context,
      parsed.data.lineId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: lineMessageFor(result.reason),
    };
  }

  revalidatePath(
    `/shipments/${parsed.data.shipmentId}`,
  );

  return {
    status: "idle",
  };
}

const transitionSchema =
  z.object({
    shipmentId:
      z.string().min(1),

    action:
      z.enum(["MARK_READY", "REOPEN", "LOCK", "VOID"]),
  });

export async function transitionShipmentAction(
  _previousState: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const parsed =
    transitionSchema.safeParse(
      {
        shipmentId: formData.get("shipmentId"),
        action: formData.get("action"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const result =
    await transitionShipmentStatus(
      supabase,
      orgSummary.context,
      parsed.data.shipmentId as never,
      parsed.data.action as ShipmentTransitionAction,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: transitionMessageFor(result.reason),
    };
  }

  revalidatePath(
    `/shipments/${parsed.data.shipmentId}`,
  );

  return {
    status: "idle",
  };
}

const resolveEmissionsSchema =
  z.object({
    lineId:
      z.string().min(1),

    shipmentId:
      z.string().min(1),
  });

/**
 * One action serves both first-time determination and re-determination
 * (docs/plans/MASTER_PLAN.md §18: re-determination must be an explicit,
 * audited action, never automatic on its own -- not that it needs a
 * separate button from the user's point of view). It always tries
 * determineLineEmissions first; ALREADY_DETERMINED means a
 * determination already exists, so it retries as an explicit
 * redetermineLineEmissions call, which persists its own, distinct audit
 * event type. Both calls are triggered only by this explicit user
 * action -- nothing here runs without the user clicking "Determine
 * emissions" / "Re-determine emissions".
 */
export async function resolveEmissionsAction(
  _previousState: ResolveEmissionsActionState,
  formData: FormData,
): Promise<ResolveEmissionsActionState> {
  const parsed =
    resolveEmissionsSchema.safeParse(
      {
        lineId: formData.get("lineId"),
        shipmentId: formData.get("shipmentId"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const repository =
    getRegulatoryRepository();

  const mapper =
    getRegulatoryCountryMapper();

  let result =
    await determineLineEmissions(
      supabase,
      repository,
      mapper,
      orgSummary.context,
      parsed.data.lineId as never,
    );

  if (
    result.status === "REJECTED" &&
    result.reason === "ALREADY_DETERMINED"
  ) {
    result =
      await redetermineLineEmissions(
        supabase,
        repository,
        mapper,
        orgSummary.context,
        parsed.data.lineId as never,
      );
  }

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: resolveEmissionsRejectionMessageFor(result.reason),
    };
  }

  if (result.status === "UNRESOLVED") {
    return {
      status: "unresolved",
      reason: result.resolution.reason,
      trace: result.resolution.trace,
      message: unresolvedMessageFor(result.resolution.reason),
    };
  }

  revalidatePath(
    `/shipments/${parsed.data.shipmentId}`,
  );

  return {
    status: "idle",
  };
}

function determineFromActualDataRejectionMessageFor(
  reason: string,
): string {
  switch (reason) {
    case "LINE_NOT_FOUND":
      return "That line could not be found.";

    case "EMISSION_DATA_NOT_FOUND":
      return "That actual-emissions dataset could not be found, or is no longer visible to your organization.";

    case "DATA_INTEGRITY_ERROR":
      return "This dataset could not be used due to a data integrity problem. Please contact support.";

    case "SHIPMENT_NOT_EDITABLE":
      return "This shipment is locked or void and can no longer be edited.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const determineFromActualDataSchema =
  z.object({
    lineId:
      z.string().min(1),

    shipmentId:
      z.string().min(1),

    emissionDataId:
      z.string().min(1),
  });

/**
 * Mirrors resolveEmissionsAction's exact "try determine first, retry as
 * redetermine on ALREADY_DETERMINED" shape (see that action's own doc
 * comment for the full reasoning -- identical here, just against the
 * ACTUAL-data determination pair in determine-from-actual-data.ts
 * instead of the DEFAULT-resolution pair in resolve-line-emissions.ts).
 * Unlike resolveEmissionsAction there is no UNRESOLVED outcome on this
 * path -- determineLineFromActualData/redetermineLineFromActualData only
 * ever return DETERMINED or REJECTED (a fetched, ACTIVE+VERIFIED
 * emission_data row is always usable on its own -- nothing here calls
 * out to the regulatory resolver, which is the only thing that can
 * produce an UNRESOLVED outcome on the DEFAULT path) -- so this reuses
 * the plain LineActionState ({status:"idle"|"error"}) rather than the
 * richer ResolveEmissionsActionState.
 */
export async function determineFromActualDataAction(
  _previousState: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const parsed =
    determineFromActualDataSchema.safeParse(
      {
        lineId: formData.get("lineId"),
        shipmentId: formData.get("shipmentId"),
        emissionDataId: formData.get("emissionDataId"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  let result =
    await determineLineFromActualData(
      supabase,
      orgSummary.context,
      parsed.data.lineId as never,
      parsed.data.emissionDataId as never,
    );

  if (
    result.status === "REJECTED" &&
    result.reason === "ALREADY_DETERMINED"
  ) {
    result =
      await redetermineLineFromActualData(
        supabase,
        orgSummary.context,
        parsed.data.lineId as never,
        parsed.data.emissionDataId as never,
      );
  }

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: determineFromActualDataRejectionMessageFor(result.reason),
    };
  }

  revalidatePath(
    `/shipments/${parsed.data.shipmentId}`,
  );

  // 2026-08-29 (mandatory review, worth-tracking, closed): the
  // determination itself always succeeds regardless of this -- see
  // DetermineFromActualDataResult's own doc comment on why a failed
  // grantor-side audit write must not fail the whole determination --
  // but crossOrgConsumptionRecorded existed specifically so a caller
  // could surface a non-silent signal instead of treating it as
  // indistinguishable from a fully clean success. This is that caller.
  if (!result.crossOrgConsumptionRecorded) {
    return {
      status: "idle",
      warning:
        "This line was determined, but recording the cross-organization data-consumption event failed. The producer's own audit trail may not reflect this yet.",
    };
  }

  return {
    status: "idle",
  };
}

const calculateLineSchema =
  z.object({
    lineId:
      z.string().min(1),

    shipmentId:
      z.string().min(1),
  });

export async function calculateLineAction(
  _previousState: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const parsed =
    calculateLineSchema.safeParse(
      {
        lineId: formData.get("lineId"),
        shipmentId: formData.get("shipmentId"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const result =
    await calculateLine(
      supabase,
      getRegulatoryRepository(),
      orgSummary.context,
      parsed.data.lineId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message:
        result.reason === "LINE_NOT_FOUND"
          ? "That line could not be found."
          : result.reason === "SHIPMENT_NOT_EDITABLE"
            ? "This shipment is locked or void and can no longer be recalculated."
            : result.reason === "CAPABILITY_NOT_HELD"
              ? "Your organization is not set up as a CBAM importer/declarant."
              : "Something went wrong. Please try again.",
    };
  }

  if (result.calculation.status !== "COMPUTED") {
    return {
      status: "error",
      message: calculationStatusMessageFor(
        result.calculation.status,
      ),
    };
  }

  revalidatePath(
    `/shipments/${parsed.data.shipmentId}`,
  );

  return {
    status: "idle",
  };
}

const verifyCalculationReproducibilitySchema =
  z.object({
    calculationResultId:
      z.string().min(1),
  });

/**
 * The on-demand half of P8's reproduction-proof contract (master plan
 * §17/§21 -- "same inputs + engine_version => byte-identical output,
 * re-provable on demand"; the CI-side half is a separate test against
 * reproduceCalculationResult directly, not this action). Follows
 * calculateLineAction's exact auth/org-context shape -- same
 * getServerSupabaseClient / getCurrentOrgSummary / getUser sequence --
 * but unlike every other action in this file, reproduceCalculationResult
 * only reads and compares (its own doc comment): it never writes to
 * calculation_results or anywhere else, so there is deliberately no
 * revalidatePath call here -- nothing about the shipment's persisted
 * state changes as a result of running this check.
 *
 * Returns reproduceCalculationResult's own ReproductionResult verbatim
 * as `result` rather than mapping it to a message the way this file's
 * other REJECTED-reason functions do -- ReproductionResult's variants
 * (REPRODUCIBLE / MISMATCH / ENGINE_VERSION_CHANGED / INPUTS_DRIFTED /
 * NOT_FOUND) are meaningfully different UI states, not interchangeable
 * error strings, so the panel that renders them needs the full typed
 * union, not a pre-collapsed message.
 *
 * Gated on org membership only (the same getCurrentOrgSummary check
 * every other action in this file uses), not hasAdminAccess -- master
 * plan §21 describes the reproduction proof's on-demand half as an
 * "admin check", but this is read-only over a calculation result the
 * member can already see rendered on the same screen (the panel that
 * renders `result` is on the same shipment-detail page this member
 * already has MEMBER+ access to), so there is no additional exposure a
 * stricter gate would prevent -- same MEMBER+-pending-§41-decision
 * reasoning app/(importer)/audit/page.tsx's own doc comment applies to
 * the audit screens, noted here since this is a deliberate divergence
 * from §21's literal wording, not an oversight (P8 security review,
 * finding #4).
 */
export async function verifyCalculationReproducibilityAction(
  _previousState: ReproductionActionState,
  formData: FormData,
): Promise<ReproductionActionState> {
  const parsed =
    verifyCalculationReproducibilitySchema.safeParse(
      {
        calculationResultId: formData.get("calculationResultId"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const result =
    await reproduceCalculationResult(
      supabase,
      getRegulatoryRepository(),
      orgSummary.context.org_id,
      parsed.data.calculationResultId as never,
    );

  return {
    status: "checked",
    result,
  };
}
