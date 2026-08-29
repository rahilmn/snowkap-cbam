// ============================================================
// Snowkap CBAM
// P11: performance-verification seed -- step 3 (measurement)
//
// Purpose:
//   Calls the REAL application functions
//   (src/application/shipments/list-shipments.ts,
//   src/application/reporting/build-period-summary.ts) against the
//   seeded org, signed in as a real authenticated user (RLS-enforced,
//   not a service-role bypass) -- this measures exactly what a real
//   request pays, matching this task's "actual wall-clock timing of
//   the real query/service function, not a guess" requirement.
//
//   Reads scripts/perf/.p11-perf-context.json (written by
//   seed-p11-perf-setup.ts) for the org id + signed-in user
//   credentials.
//
// Usage:
//   pnpm exec tsx scripts/perf/measure-p11-perf.ts
// ============================================================

import {
  createClient,
} from "@supabase/supabase-js";

import {
  readFileSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

import {
  dirname,
  join,
} from "node:path";

import {
  listShipments,
} from "../../src/application/shipments/list-shipments";

import {
  buildPeriodSummary,
} from "../../src/application/reporting/build-period-summary";

const __dirname =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

interface PerfContext {
  runId: string;
  orgId: string;
  userId: string;
  email: string;
  password: string;
}

function loadContext(): PerfContext {
  return JSON.parse(
    readFileSync(
      join(
        __dirname,
        ".p11-perf-context.json",
      ),
      "utf-8",
    ),
  ) as PerfContext;
}

function percentile(
  sortedMs: number[],
  p: number,
): number {
  const idx =
    Math.min(
      sortedMs.length - 1,
      Math.floor(p * sortedMs.length),
    );

  return sortedMs[idx];
}

async function timeRuns<T>(
  label: string,
  runs: number,
  fn: () => Promise<T>,
): Promise<{ result: T; durationsMs: number[] }> {
  const durationsMs: number[] =
    [];

  let result: T | undefined;

  for (let i = 0; i < runs; i++) {
    const start =
      performance.now();

    result =
      await fn();

    const durationMs =
      performance.now() - start;

    durationsMs.push(
      durationMs,
    );

    console.log(
      `  [${label}] run ${i + 1}/${runs}: ${durationMs.toFixed(1)} ms`,
    );
  }

  return {
    result: result as T,
    durationsMs,
  };
}

async function main() {
  const context =
    loadContext();

  const client =
    createClient(
      LOCAL_API_URL,
      LOCAL_ANON_KEY,
      {
        auth: { persistSession: false },
      },
    );

  const { error: signInError } =
    await client.auth.signInWithPassword(
      {
        email: context.email,
        password: context.password,
      },
    );

  if (signInError) {
    throw new Error(
      `Failed to sign in perf user: ${signInError.message}`,
    );
  }

  console.log(
    `Signed in as org ${context.orgId} (run ${context.runId})`,
  );

  console.log(
    "\n=== listShipments (org_id filter, order by created_at desc, unbounded) ===",
  );

  const shipmentsRun =
    await timeRuns(
      "listShipments",
      5,
      () =>
        listShipments(
          client,
          context.orgId as never,
        ),
    );

  console.log(
    `  rows returned: ${shipmentsRun.result.length}`,
  );

  console.log(
    "\n=== buildPeriodSummary (ANNUAL 2026 -- the single period every seeded shipment falls in) ===",
  );

  const periodRun =
    await timeRuns(
      "buildPeriodSummary",
      5,
      () =>
        buildPeriodSummary(
          client,
          context.orgId as never,
          { kind: "ANNUAL", year: 2026 },
        ),
    );

  console.log(
    `  shipment_count: ${periodRun.result.shipment_count}`,
  );

  console.log(
    `  line_count: ${periodRun.result.line_count}`,
  );

  console.log(
    `  calculated_line_count: ${periodRun.result.calculated_line_count}`,
  );

  console.log(
    `  incomplete_lines: ${periodRun.result.incomplete_lines.length}`,
  );

  console.log(
    `  total_embedded_emissions_tco2e: ${periodRun.result.total_embedded_emissions_tco2e}`,
  );

  function summarize(
    label: string,
    durationsMs: number[],
  ) {
    const sorted =
      [...durationsMs].sort(
        (a, b) => a - b,
      );

    console.log(
      `\n${label}: min=${sorted[0].toFixed(1)}ms median=${percentile(sorted, 0.5).toFixed(1)}ms p95=${percentile(sorted, 0.95).toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`,
    );
  }

  summarize(
    "listShipments",
    shipmentsRun.durationsMs,
  );

  summarize(
    "buildPeriodSummary",
    periodRun.durationsMs,
  );
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exit(
      1,
    );
  },
);
