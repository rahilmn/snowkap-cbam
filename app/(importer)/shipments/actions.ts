"use server";

import { z } from "zod";

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
  createShipment,
} from "../../../src/application/shipments/create-shipment";

import type {
  ShipmentActionState,
} from "./action-state";

function messageFor(
  reason: string,
): string {
  switch (reason) {
    case "INVALID_DATE":
      return "Enter a valid release date (YYYY-MM-DD).";

    case "DUPLICATE_REFERENCE":
      return "A shipment with that reference already exists.";

    default:
      return "Something went wrong. Please try again.";
  }
}

const createShipmentSchema =
  z.object({
    reference:
      z.string().min(1, "Enter a shipment reference."),

    releaseDate:
      z.string().min(1, "Enter a release date."),

    customsMrn:
      z.string().optional(),

    customsProcedure:
      z.enum(["RELEASE_FOR_FREE_CIRCULATION", "INWARD_PROCESSING"]).optional(),
  });

export async function createShipmentAction(
  _previousState: ShipmentActionState,
  formData: FormData,
): Promise<ShipmentActionState> {
  const parsed =
    createShipmentSchema.safeParse(
      {
        reference: formData.get("reference"),
        releaseDate: formData.get("releaseDate"),
        customsMrn: formData.get("customsMrn") ?? undefined,
        customsProcedure: formData.get("customsProcedure") || undefined,
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

  const result =
    await createShipment(
      supabase,
      orgSummary.context.org_id,
      user.id as never,
      {
        reference: parsed.data.reference,
        releaseDate: parsed.data.releaseDate,
        customsMrn: parsed.data.customsMrn?.trim() || null,
        customsProcedure: parsed.data.customsProcedure ?? null,
      },
    );

  if (result.status === "REJECTED") {
    return {
      status: "error",
      message: messageFor(result.reason),
    };
  }

  redirect(
    `/shipments/${result.shipment.id}`,
  );
}
