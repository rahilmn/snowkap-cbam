import "server-only";

import {
  NextResponse,
} from "next/server";

import {
  getSupabaseClient,
} from "../../../src/infrastructure/supabase/client";

import {
  log,
} from "../../../src/infrastructure/observability/logger";

export const dynamic =
  "force-dynamic";

interface HealthCheckResult {
  status:
    | "ok"
    | "degraded";

  git_sha: string;

  checks: {
    database:
      | "ok"
      | "error";

    active_regulatory_dataset:
      | "ok"
      | "missing"
      | "duplicate"
      | "error";
  };
}

/**
 * The health check Railway's healthcheck hits (see the future
 * Dockerfile/Railway service config, docs/plans/MASTER_PLAN.md §29).
 * Verifies process liveness, database reachability, and the one
 * regulatory invariant a broken deploy could silently violate: exactly
 * one ACTIVE DEFAULT_EMISSION_VALUES dataset. It does not verify full
 * regulatory correctness (that is pnpm regulatory:verify's job) --
 * only that the shape a healthy app depends on is present.
 */
export async function GET(): Promise<NextResponse<HealthCheckResult>> {
  const gitSha =
    process.env.GIT_SHA ??
    "dev";

  const result: HealthCheckResult = {
    status:
      "ok",

    git_sha:
      gitSha,

    checks: {
      database:
        "ok",

      active_regulatory_dataset:
        "ok",
    },
  };

  try {
    const supabase =
      getSupabaseClient();

    const {
      data,
      error,
    } = await supabase
      .from(
        "regulatory_datasets",
      )
      .select(
        "id",
      )
      .eq(
        "dataset_type",
        "DEFAULT_EMISSION_VALUES",
      )
      .eq(
        "status",
        "ACTIVE",
      )
      .limit(
        2,
      );

    if (error) {
      result.checks.database =
        "error";

      result.status =
        "degraded";
    } else if ((data ?? []).length === 0) {
      result.checks.active_regulatory_dataset =
        "missing";

      result.status =
        "degraded";
    } else if ((data ?? []).length > 1) {
      result.checks.active_regulatory_dataset =
        "duplicate";

      result.status =
        "degraded";
    }
  } catch (caught) {
    result.checks.database =
      "error";

    result.status =
      "degraded";

    log(
      "error",
      "health check database connectivity failed",
      {
        error:
          caught instanceof Error
            ? caught.message
            : String(caught),
      },
    );
  }

  return NextResponse.json(
    result,
    {
      status:
        result.status === "ok"
          ? 200
          : 503,
    },
  );
}
