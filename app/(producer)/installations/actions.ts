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
  createOperator,
  removeOperator,
} from "../../../src/application/installations/manage-operators";

import {
  createInstallation,
  removeInstallation,
} from "../../../src/application/installations/manage-installations";

import type {
  InstallationRecordProvenance,
} from "../../../src/domain/installations/types";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import type {
  InstallationsScreenActionState,
} from "./action-state";

function rateLimitedState(
  retryAfterMs: number,
): InstallationsScreenActionState {
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
 * Plain per-record creates a legitimate producer can reasonably repeat
 * many times while registering a batch of operators/installations
 * during onboarding -- generous, matching createShipmentAction's/
 * createSupplierAction's own 60/10min for the same "ordinary bulk data
 * entry" reasoning. One shared config/limiter pair per create action,
 * since operators and installations are registered independently.
 */
const CREATE_OPERATOR_RATE_LIMIT: RateLimitConfig =
  {
    limit: 60,
    windowMs: 10 * 60 * 1000,
  };

const createOperatorLimiter =
  createInMemoryRateLimiter(
    CREATE_OPERATOR_RATE_LIMIT,
  );

const CREATE_INSTALLATION_RATE_LIMIT: RateLimitConfig =
  {
    limit: 60,
    windowMs: 10 * 60 * 1000,
  };

const createInstallationLimiter =
  createInMemoryRateLimiter(
    CREATE_INSTALLATION_RATE_LIMIT,
  );

/**
 * Deletion is rarer and more consequential than creation (removing an
 * operator/installation record, which INSTALLATION_HAS_DEPENDENTS
 * already guards once real activity exists against it) -- tighter than
 * the create limiters above, matching removeSupplierAction's own
 * 30/10min.
 */
const REMOVE_OPERATOR_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const removeOperatorLimiter =
  createInMemoryRateLimiter(
    REMOVE_OPERATOR_RATE_LIMIT,
  );

const REMOVE_INSTALLATION_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const removeInstallationLimiter =
  createInMemoryRateLimiter(
    REMOVE_INSTALLATION_RATE_LIMIT,
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

const createOperatorSchema =
  z.object({
    name:
      z.string().min(1, "Enter an operator name."),

    country:
      z.string().min(1, "Country is required."),

    contactEmail:
      z.string().optional(),
  });

// 2026-09-03 (owner decision D2): the importer-side flow this comment
// anticipated ("separate, later UI reusing the same application services
// with provenance: IMPORTER_ENTERED") now exists, at
// /external-operators. It reuses these same actions rather than copying
// them -- see performCreateOperator below.
function capabilityMessageFor(
  provenance: InstallationRecordProvenance,
): string {
  return provenance === "OPERATOR_PROVIDED"
    ? "Your organization is not set up as a CBAM producer/operator."
    : "Your organization is not set up as a CBAM importer/declarant.";
}

/**
 * 2026-09-03 (owner decision D2). One implementation, two provenances.
 *
 * A producer registering its own operator and an importer recording an
 * external operator's details create the SAME record with the SAME
 * validation, rate limiting and ownership rules -- they differ only in
 * what the record CLAIMS about where it came from, and in which screen
 * to revalidate afterwards.
 *
 * Parameterised rather than copied. Two copies of a 60-line action
 * would have drifted the first time a field or a check was added, and
 * "extend the architecture rather than creating a second parallel
 * model" is the decision's own instruction.
 *
 * The provenance is fixed by the CALLER (each exported action below
 * passes a literal), never read from the form: it is an authorization
 * claim, and a client-supplied one would be worthless. The application
 * re-checks it against the org's capabilities
 * (capabilityAllowsProvenance) and the database enforces the same rule
 * (app.enforce_record_provenance_capability, 20260903120000).
 */
async function performCreateOperator(
  formData: FormData,
  provenance: InstallationRecordProvenance,
  revalidateTarget: string,
): Promise<InstallationsScreenActionState> {
  const rateLimitResult =
    createOperatorLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    createOperatorSchema.safeParse(
      {
        name: formData.get("name"),
        country: formData.get("country"),
        contactEmail: formData.get("contactEmail") ?? undefined,
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
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await createOperator(
      setup.supabase,
      setup.orgSummary.context,
      {
        provenance,
        name: parsed.data.name,
        country: parsed.data.country.trim().toUpperCase(),
        contactEmail: parsed.data.contactEmail?.trim() || null,
      },
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message:
        result.reason === "INVALID_COUNTRY"
          ? "Country must be a 2-letter ISO code (e.g. DE, CN)."
          : result.reason === "CAPABILITY_NOT_HELD"
            ? capabilityMessageFor(provenance)
            : "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    revalidateTarget,
  );

  return {
    status: "idle",
  };
}

const removeOperatorSchema =
  z.object({
    operatorId:
      z.string().min(1),
  });

export async function removeOperatorAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
  const rateLimitResult =
    removeOperatorLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    removeOperatorSchema.safeParse(
      {
        operatorId: formData.get("operatorId"),
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
    await removeOperator(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.operatorId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    "/installations",
  );

  return {
    status: "idle",
  };
}

const createInstallationSchema =
  z.object({
    operatorId:
      z.string().min(1, "Choose an operator."),

    name:
      z.string().min(1, "Enter an installation name."),

    country:
      z.string().min(1, "Country is required."),

    unLocode:
      z.string().optional(),

    address:
      z.string().optional(),

    cbamInstallationId:
      z.string().optional(),
  });

// Same shape and reasoning as performCreateOperator above.
async function performCreateInstallation(
  formData: FormData,
  provenance: InstallationRecordProvenance,
  revalidateTarget: string,
): Promise<InstallationsScreenActionState> {
  const rateLimitResult =
    createInstallationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    createInstallationSchema.safeParse(
      {
        operatorId: formData.get("operatorId"),
        name: formData.get("name"),
        country: formData.get("country"),
        unLocode: formData.get("unLocode") ?? undefined,
        address: formData.get("address") ?? undefined,
        cbamInstallationId: formData.get("cbamInstallationId") ?? undefined,
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
    await requireOrgAndUser();

  if (setup.status === "error") {
    return setup;
  }

  const result =
    await createInstallation(
      setup.supabase,
      setup.orgSummary.context,
      {
        operatorId: parsed.data.operatorId as never,
        provenance,
        name: parsed.data.name,
        country: parsed.data.country.trim().toUpperCase(),
        unLocode: parsed.data.unLocode?.trim().toUpperCase() || null,
        address: parsed.data.address?.trim() || null,
        cbamInstallationId: parsed.data.cbamInstallationId?.trim() || null,
      },
    );

  if (result.status === "REJECTED") {
    const message =
      result.reason === "INVALID_COUNTRY"
        ? "Country must be a 2-letter ISO code (e.g. DE, CN)."
        : result.reason === "OPERATOR_NOT_FOUND"
        ? "Choose a valid operator."
        : result.reason === "CAPABILITY_NOT_HELD"
        ? capabilityMessageFor(provenance)
        : "Something went wrong. Please try again.";

    return {
      status: "error",
      message,
    };
  }

  revalidatePath(
    "/installations",
  );

  return {
    status: "idle",
  };
}

const removeInstallationSchema =
  z.object({
    installationId:
      z.string().min(1),
  });

export async function removeInstallationAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
  const rateLimitResult =
    removeInstallationLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return rateLimitedState(
      rateLimitResult.retryAfterMs,
    );
  }

  const parsed =
    removeInstallationSchema.safeParse(
      {
        installationId: formData.get("installationId"),
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
    await removeInstallation(
      setup.supabase,
      setup.orgSummary.context,
      parsed.data.installationId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message:
        result.reason === "INSTALLATION_HAS_DEPENDENTS"
          ? "This installation has emission records or sharing grants in its history and can't be removed. That history is kept even after data is discarded or a grant is revoked, so this installation can no longer be deleted -- only installations with no recorded activity can be."
          : "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    "/installations",
  );

  return {
    status: "idle",
  };
}

/**
 * Producer self-registration: this organization's own operator.
 */
export async function createOperatorAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
  return performCreateOperator(
    formData,
    "OPERATOR_PROVIDED",
    "/installations",
  );
}

/**
 * Producer self-registration: this organization's own installation.
 */
export async function createInstallationAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
  return performCreateInstallation(
    formData,
    "OPERATOR_PROVIDED",
    "/installations",
  );
}

/**
 * 2026-09-03 (owner decision D2). An importer recording an EXTERNAL
 * operator -- one that does not use Snowkap.
 *
 * IMPORTER_ENTERED does not mean invented or self-certified. It means
 * transcribed from information the operator supplied off-platform, and
 * every surface that renders it says so.
 */
export async function createExternalOperatorAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
  return performCreateOperator(
    formData,
    "IMPORTER_ENTERED",
    "/external-operators",
  );
}

/**
 * The installation half of the same flow.
 */
export async function createExternalInstallationAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
  return performCreateInstallation(
    formData,
    "IMPORTER_ENTERED",
    "/external-operators",
  );
}
