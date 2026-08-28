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
  createSupplier,
  removeSupplier,
} from "../../../src/application/suppliers/manage-suppliers";

import type {
  SupplierActionState,
} from "./action-state";

const createSupplierSchema =
  z.object({
    name:
      z.string().min(1, "Enter a supplier name."),

    country:
      z.string().optional(),

    contactName:
      z.string().optional(),

    contactEmail:
      z.string().optional(),
  });

export async function createSupplierAction(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const parsed =
    createSupplierSchema.safeParse(
      {
        name: formData.get("name"),
        country: formData.get("country") ?? undefined,
        contactName: formData.get("contactName") ?? undefined,
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

  const country =
    parsed.data.country?.trim().toUpperCase() || null;

  const result =
    await createSupplier(
      supabase,
      orgSummary.context.org_id,
      user.id as never,
      {
        name: parsed.data.name,
        country,
        contactName: parsed.data.contactName?.trim() || null,
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
    "/suppliers",
  );

  return {
    status: "idle",
  };
}

const removeSupplierSchema =
  z.object({
    supplierId:
      z.string().min(1),
  });

export async function removeSupplierAction(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const parsed =
    removeSupplierSchema.safeParse(
      {
        supplierId: formData.get("supplierId"),
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
    await removeSupplier(
      supabase,
      orgSummary.context.org_id,
      user.id as never,
      parsed.data.supplierId as never,
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath(
    "/suppliers",
  );

  return {
    status: "idle",
  };
}
