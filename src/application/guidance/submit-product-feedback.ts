import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "../organizations/org-context";

import {
  resolveGitSha,
} from "../health/resolve-git-sha";

export interface SubmitProductFeedbackInput {
  rating: number;
  comment?: string | null;
  page: string;
  workflow?: string | null;
  context?: Record<string, unknown>;
}

export type SubmitProductFeedbackResult =
  | { status: "OK" }
  | { status: "VALIDATION_FAILED"; message: string }
  | { status: "PERSIST_FAILED" };

/**
 * Insert-only (product_feedback_insert_own_org_as_self,
 * 20260905170000 -- no UPDATE/DELETE policy exists, by design).
 * user_id is never sent -- trigger-pinned from auth.uid(), same
 * posture as every other actor column in this schema.
 *
 * Deliberately does NOT chain `.select()` after `.insert()` --
 * "Do not assume insert() return shape. Pin actual behavior in
 * tests" (v2.1.1). Matches recordAuditEvent's own established
 * precedent (src/application/audit/record-audit-event.ts): a caller
 * that needs the row back would have to trust PostgREST's own RETURNING
 * survives whatever RLS SELECT policy exists, which this codebase does
 * not assume anywhere else either. `{ status: "OK" }` on no error is
 * enough for a submit-and-thank-you flow.
 *
 * `env` defaults to `process.env` but is a parameter so release-SHA
 * capture is directly testable, same shape resolveGitSha itself
 * already uses.
 */
export async function submitProductFeedback(
  supabase: SupabaseClient,
  context: OrgContext,
  input: SubmitProductFeedbackInput,
  env: Record<string, string | undefined> = process.env,
): Promise<SubmitProductFeedbackResult> {
  if (
    !Number.isInteger(input.rating) ||
    input.rating < 1 ||
    input.rating > 5
  ) {
    return {
      status: "VALIDATION_FAILED",
      message: "Rating must be a whole number between 1 and 5.",
    };
  }

  if (input.page.trim().length === 0) {
    return {
      status: "VALIDATION_FAILED",
      message: "Page is required.",
    };
  }

  const { error } =
    await supabase
      .from("product_feedback")
      .insert(
        {
          org_id: context.org_id,
          rating: input.rating,
          comment: input.comment ?? null,
          page: input.page,
          workflow: input.workflow ?? null,
          context: input.context ?? {},
          release_sha: resolveGitSha(env),
        },
      );

  if (error) {
    return {
      status: "PERSIST_FAILED",
    };
  }

  return {
    status: "OK",
  };
}
