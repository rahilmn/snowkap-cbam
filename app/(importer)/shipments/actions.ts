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

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import type {
  ShipmentActionState,
} from "./action-state";

/**
 * A plain per-record create a legitimate user can reasonably do many
 * times in one working session (entering a batch of shipments), so
 * this is deliberately generous -- matching createSupplierAction's and
 * recordEmissionDataAction's own 60/10min for the same "ordinary bulk
 * data entry" reasoning, well short of anything that would throttle
 * real use while still bounding automated/scripted shipment creation.
 */
const CREATE_SHIPMENT_RATE_LIMIT: RateLimitConfig =
  {
    limit: 60,
    windowMs: 10 * 60 * 1000,
  };

const createShipmentLimiter =
  createInMemoryRateLimiter(
    CREATE_SHIPMENT_RATE_LIMIT,
  );

function messageFor(
  reason: string,
): string {
  switch (reason) {
    case "INVALID_DATE":
      return "Enter a valid release date (YYYY-MM-DD).";

    case "DUPLICATE_REFERENCE":
      return "A shipment with that reference already exists.";

    case "CAPABILITY_NOT_HELD":
      return "Your organization is not set up as a CBAM importer/declarant.";

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
  const rateLimitResult =
    createShipmentLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(rateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many requests. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

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
      orgSummary.context,
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
