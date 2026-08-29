// ============================================================
// Snowkap CBAM
// P11: performance-verification seed -- step 4 (cleanup)
//
// Purpose:
//   Removes the synthetic org this task's seed created from local
//   Postgres -- this is dev-environment scratch data, not a fixture
//   other tests depend on (this task's own instruction, step 4).
//   Deleting the organizations row cascades to shipments (on delete
//   cascade) -> shipment_lines (on delete cascade) ->
//   calculation_results (on delete cascade) and to memberships (on
//   delete cascade) in one statement -- see
//   20260828150000_p4_shipment_intake_schema.sql and
//   20260829180000_p6_calculation_results_schema.sql for those FKs.
//   audit_events.org_id is ON DELETE RESTRICT (deliberately, per
//   20260828070000's header comment), but nothing in this seed ever
//   wrote an audit_events row -- see seed-p11-perf-setup.ts's own
//   header comment (direct table inserts, not the
//   create_organization_with_owner RPC that's the only thing that
//   writes one) -- so no RESTRICT violation is expected here.
//
// Usage:
//   pnpm exec tsx scripts/perf/cleanup-p11-perf.ts
// ============================================================

import {
  createClient,
} from "@supabase/supabase-js";

import {
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

import {
  dirname,
  join,
} from "node:path";

const __dirname =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

interface PerfContext {
  runId: string;
  orgId: string;
  userId: string;
  email: string;
  password: string;
}

async function main() {
  const contextPath =
    join(
      __dirname,
      ".p11-perf-context.json",
    );

  if (!existsSync(contextPath)) {
    console.log(
      "No .p11-perf-context.json found -- nothing to clean up.",
    );

    return;
  }

  const context =
    JSON.parse(
      readFileSync(
        contextPath,
        "utf-8",
      ),
    ) as PerfContext;

  const serviceClient =
    createClient(
      LOCAL_API_URL,
      LOCAL_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
      },
    );

  console.log(
    `Deleting org ${context.orgId} (run ${context.runId}) -- cascades shipments/lines/calculation_results/memberships...`,
  );

  const { error: orgDeleteError } =
    await serviceClient
      .from("organizations")
      .delete()
      .eq(
        "id",
        context.orgId,
      );

  if (orgDeleteError) {
    throw new Error(
      `Failed to delete perf org: ${orgDeleteError.message}`,
    );
  }

  console.log(
    `Deleting auth user ${context.userId}...`,
  );

  const { error: userDeleteError } =
    await serviceClient.auth.admin.deleteUser(
      context.userId,
    );

  if (userDeleteError) {
    throw new Error(
      `Failed to delete perf user: ${userDeleteError.message}`,
    );
  }

  unlinkSync(
    contextPath,
  );

  console.log(
    "Cleanup complete.",
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
