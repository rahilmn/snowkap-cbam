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
  InstallationsScreenActionState,
} from "./action-state";

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

// This screen is producer-side self-registration only (a producer org
// registering its own operator/installation) -- provenance is always
// OPERATOR_PROVIDED here. The importer-side "add a local record for an
// off-platform producer" flow (docs/plans/MASTER_PLAN.md §27.17) is
// separate, later UI reusing the same application services with
// provenance: "IMPORTER_ENTERED".
export async function createOperatorAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
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
      setup.orgSummary.context.org_id,
      setup.user.id as never,
      {
        provenance: "OPERATOR_PROVIDED",
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

const removeOperatorSchema =
  z.object({
    operatorId:
      z.string().min(1),
  });

export async function removeOperatorAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
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
      setup.orgSummary.context.org_id,
      setup.user.id as never,
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

export async function createInstallationAction(
  _previousState: InstallationsScreenActionState,
  formData: FormData,
): Promise<InstallationsScreenActionState> {
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
      setup.orgSummary.context.org_id,
      setup.user.id as never,
      {
        operatorId: parsed.data.operatorId as never,
        provenance: "OPERATOR_PROVIDED",
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
      setup.orgSummary.context.org_id,
      setup.user.id as never,
      parsed.data.installationId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message:
        result.reason === "INSTALLATION_HAS_DEPENDENTS"
          ? "This installation has emission records or sharing grants attached and can't be removed. Discard its emission data and revoke any sharing grants first."
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
