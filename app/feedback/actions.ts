"use server";

import { z } from "zod";

import { redirect } from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../components/shell/get-client-ip";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  submitProductFeedback,
} from "../../src/application/guidance/submit-product-feedback";

import type {
  FeedbackActionState,
} from "./action-state";

/**
 * IP-keyed, matching every other real-mutation action in this codebase
 * (app/(auth)/actions.ts's signUpLimiter, app/onboarding/actions.ts's
 * createOrganizationLimiter) -- product_feedback is insert-only and
 * genuinely open-ended in volume (unlike guidance dismissal, which is
 * capped by the number of real guidance items that exist), so it is
 * the kind of endpoint P11 §28 names for rate limiting.
 */
const SUBMIT_FEEDBACK_RATE_LIMIT: RateLimitConfig =
  {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  };

const submitFeedbackLimiter =
  createInMemoryRateLimiter(
    SUBMIT_FEEDBACK_RATE_LIMIT,
  );

const submitFeedbackSchema =
  z.object({
    rating:
      z.coerce.number().int().min(1).max(5),

    comment:
      z.string().trim().max(2000).optional(),

    page:
      z.string().trim().min(1, "Page is required."),

    workflow:
      z.string().trim().optional(),
  });

export async function submitFeedbackAction(
  _previousState: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const rateLimitResult =
    submitFeedbackLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    const retryAfterSeconds =
      Math.ceil(rateLimitResult.retryAfterMs / 1000);

    return {
      status: "error",
      message:
        `Too many attempts. Try again in ${retryAfterSeconds} ` +
        `${retryAfterSeconds === 1 ? "second" : "seconds"}.`,
    };
  }

  const parsed =
    submitFeedbackSchema.safeParse(
      {
        rating: formData.get("rating"),
        comment: formData.get("comment") || undefined,
        page: formData.get("page"),
        workflow: formData.get("workflow") || undefined,
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
    redirect(
      "/sign-in",
    );
  }

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    redirect(
      "/onboarding",
    );
  }

  const result =
    await submitProductFeedback(
      supabase,
      orgSummary.context,
      {
        rating: parsed.data.rating,
        comment: parsed.data.comment,
        page: parsed.data.page,
        workflow: parsed.data.workflow,
      },
    );

  if (result.status !== "OK") {
    return {
      status: "error",
      message: "Something went wrong sending your feedback. Please try again.",
    };
  }

  return {
    status: "success",
    message: "Thanks -- your feedback was sent.",
  };
}
