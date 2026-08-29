// ============================================================
// Snowkap CBAM
// P11: performance-verification seed -- step 1 (org + user + membership)
//
// Purpose:
//   docs/plans/MASTER_PLAN.md §33 budgets can only be verified against
//   real, seeded volumes on local Postgres -- this is the small,
//   supabase-js half of that seed (org/auth-user/membership), split
//   out from the bulk shipments/shipment_lines/calculation_results
//   insert (seed-p11-perf-bulk.sql) because those tens of thousands of
//   rows go through raw SQL for speed, while identity creation (a
//   correctly bcrypt-hashed password, an auth.identities row, etc.)
//   genuinely needs GoTrue's own admin API -- the same reasoning
//   tests/integration/shipments-isolation.test.ts's own header comment
//   gives for using serviceClient.auth.admin.createUser rather than a
//   raw INSERT into auth.users.
//
//   Scratch/dev-only: not a fixture, not wired into any test suite.
//   Deletes itself via cleanup-p11-perf.ts when the P11 perf
//   verification run is done -- see that file's own header comment.
//
// Usage:
//   pnpm exec tsx scripts/perf/seed-p11-perf-setup.ts
//   (writes org id / user id / credentials to
//   scripts/perf/.p11-perf-context.json for the SQL bulk-seed step and
//   the measurement script to pick up)
// ============================================================

import {
  createClient,
} from "@supabase/supabase-js";

import {
  randomBytes,
} from "node:crypto";

import {
  writeFileSync,
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

// Same local demo JWTs already committed in
// tests/integration/shipments-isolation.test.ts -- fixed, non-secret,
// local-Supabase-only credentials, not project secrets.
const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function main() {
  const serviceClient =
    createClient(
      LOCAL_API_URL,
      LOCAL_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
      },
    );

  const runId =
    crypto.randomUUID().slice(
      0,
      8,
    );

  const { data: org, error: orgError } =
    await serviceClient
      .from("organizations")
      .insert(
        {
          name: `P11 Perf Verification Org ${runId}`,
          slug: `p11-perf-verification-${runId}`,
          capabilities: ["IMPORTER_DECLARANT"],
        },
      )
      .select("id")
      .single();

  if (orgError || !org) {
    throw new Error(
      `Failed to create perf org: ${orgError?.message}`,
    );
  }

  // 2026-08-29 (P11 mandatory security review, N3, SHOULD-FIX,
  // confirmed live): previously a fixed template
  // (`p11-perf-${runId}-password!`) over the SAME runId that is also
  // published, in plain sight, in the org name/slug/email above --
  // anyone who can see the seeded org (its name, its slug, or its
  // owner's email, all of which appear in ordinary application UI/
  // logs/screenshots) can DERIVE this password without ever reading a
  // log line. crypto.randomBytes, independent of runId, closes that:
  // the password no longer has any relationship to anything this
  // script writes anywhere else.
  const password =
    randomBytes(24).toString(
      "base64url",
    );

  const email =
    `p11-perf-owner-${runId}@example.com`;

  const { data: user, error: userError } =
    await serviceClient.auth.admin.createUser(
      {
        email,
        password,
        email_confirm: true,
      },
    );

  if (userError || !user.user) {
    throw new Error(
      `Failed to create perf user: ${userError?.message}`,
    );
  }

  const { error: membershipError } =
    await serviceClient
      .from("memberships")
      .insert(
        {
          org_id: org.id,
          user_id: user.user.id,
          role: "OWNER",
        },
      );

  if (membershipError) {
    throw new Error(
      `Failed to create perf membership: ${membershipError.message}`,
    );
  }

  const context =
    {
      runId,
      orgId: org.id,
      userId: user.user.id,
      email,
      password,
    };

  writeFileSync(
    join(
      __dirname,
      ".p11-perf-context.json",
    ),
    JSON.stringify(
      context,
      null,
      2,
    ),
  );

  // 2026-08-29 (P11 mandatory security review, N3, SHOULD-FIX,
  // confirmed live): previously JSON.stringify(context, ...), which
  // includes `password` -- printed verbatim to stdout (terminal
  // scrollback, CI logs, anything capturing this process). The
  // context FILE (gitignored -- .gitignore:24-32) is the only place
  // this credential needs to live; downstream scripts
  // (measure-p11-perf.ts, cleanup-p11-perf.ts) already read it from
  // there, never from this script's own stdout.
  const { password: _password, ...contextWithoutPassword } =
    context;

  console.log(
    JSON.stringify(
      contextWithoutPassword,
      null,
      2,
    ),
  );

  console.log(
    "(password written to .p11-perf-context.json only -- not printed)",
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
