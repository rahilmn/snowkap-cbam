"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import type {
  OnboardingActionState,
} from "./action-state";

// Mirrors organizations_slug_format_ck in
// supabase/migrations/20260828070000_create_organizations_foundation.sql.
const SLUG_PATTERN =
  /^[a-z0-9]+(-[a-z0-9]+)*$/;

const createOrganizationSchema =
  z.object({
    name:
      z.string().min(1, "Enter your organization's name."),

    slug:
      z.string().regex(
        SLUG_PATTERN,
        "Use lowercase letters, numbers, and hyphens only.",
      ),

    capabilities:
      z
        .array(
          z.enum(["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"]),
        )
        .min(
          1,
          "Choose at least one.",
        ),
  });

export async function createOrganizationAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const parsed =
    createOrganizationSchema.safeParse(
      {
        name: formData.get("name"),
        slug: formData.get("slug"),
        capabilities: formData.getAll("capabilities"),
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { error } =
    await supabase.rpc(
      "create_organization_with_owner",
      {
        p_name: parsed.data.name,
        p_slug: parsed.data.slug,
        p_capabilities: parsed.data.capabilities,
      },
    );

  if (error) {
    const message =
      error.message.toLowerCase().includes("duplicate") ||
      error.code === "23505"
        ? "That organization URL is already taken -- try a different one."
        : "Something went wrong creating your organization. Please try again.";

    return {
      status: "error",
      message,
    };
  }

  redirect("/");
}
