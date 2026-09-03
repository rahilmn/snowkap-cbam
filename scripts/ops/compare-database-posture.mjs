#!/usr/bin/env node
/**
 * Compare the SECURITY POSTURE of two Postgres databases, object by
 * object, and fail if they differ.
 *
 * Why this exists. The 2026-09-03 restore drill compared tables, the
 * RLS-enabled flag, functions and triggers, found all four matching,
 * and called the restore good. It was not good: five of fifty-six RLS
 * INSERT policies were missing, because the dump excluded the `auth`
 * schema and every policy whose expression calls `auth.uid()` failed to
 * restore. The four checks that ran all passed on a database whose
 * write authorization had silently collapsed.
 *
 * So the lesson this script encodes is narrow and specific: "the tables
 * are there and RLS is on" is not a recovery test. What matters is the
 * text of every policy, the exact grant set, and whether the references
 * those policies make actually resolve. Those are the three things the
 * drill did not look at, and all three are checked here.
 *
 * Usage:
 *
 *     node scripts/ops/compare-database-posture.mjs <source-dsn> <target-dsn>
 *     node scripts/ops/compare-database-posture.mjs --check <dsn>
 *
 * The second form runs only the self-consistency checks (the ones that
 * need one database, not two) -- useful against a restored target
 * before a source is available to compare with.
 *
 * Exits 0 when every check matches, 1 when any check differs, 2 on a
 * usage or connection error. Differences are printed with the first
 * twenty differing rows per check, source-side and target-side, so the
 * output says what is missing rather than only that something is.
 *
 * Requires `psql` on PATH. Deliberately no new npm dependency: this is
 * an operations script that has to run in a recovery situation, where
 * "pnpm install first" is a bad instruction.
 */

import { spawnSync } from "node:child_process";

/**
 * Every check is a named query returning one normalized row per object.
 * Rows are compared as sorted multisets of strings, so ordering
 * differences between two servers never register as a defect while a
 * genuine missing object always does.
 *
 * `critical: true` marks the checks whose failure means the restored
 * database is not safe to serve traffic. The others are reported and
 * still fail the run, but the summary separates them so a real recovery
 * can triage.
 */
const CHECKS = [
  {
    name: "schemas",
    critical: true,
    why: "auth/storage/extensions must exist or the policies that reference them cannot resolve",
    sql: `
      select nspname
      from pg_namespace
      where nspname not like 'pg\\_%'
        and nspname <> 'information_schema'
      order by 1
    `,
  },
  {
    name: "tables",
    critical: true,
    why: "a missing table is a missing record",
    sql: `
      select table_schema || '.' || table_name
      from information_schema.tables
      where table_schema in ('public', 'app')
        and table_type = 'BASE TABLE'
      order by 1
    `,
  },
  {
    name: "columns",
    critical: true,
    why: "a column that came back nullable, or with a different default, changes what the database will accept",
    sql: `
      select table_schema || '.' || table_name || '.' || column_name
             || ' | ' || data_type
             || ' | null=' || is_nullable
             || ' | default=' || coalesce(column_default, '-')
      from information_schema.columns
      where table_schema in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "rls_enabled",
    critical: true,
    why: "the check the drill did run -- kept, because it is necessary even though it is nowhere near sufficient",
    sql: `
      select n.nspname || '.' || c.relname
             || ' | rls=' || c.relrowsecurity
             || ' | forced=' || c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "policy_definitions",
    critical: true,
    why: "THE check the drill was missing. Compares the full USING and WITH CHECK text, not the policy count",
    sql: `
      select schemaname || '.' || tablename || ' | ' || policyname
             || ' | ' || cmd
             || ' | roles=' || array_to_string(roles, ',')
             || ' | permissive=' || permissive
             || ' | using=' || coalesce(qual, '-')
             || ' | check=' || coalesce(with_check, '-')
      from pg_policies
      where schemaname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "effective_grants",
    critical: true,
    why: "the second thing the drill never looked at. A dump taken with --no-privileges carries none of these",
    sql: `
      select table_schema || '.' || table_name
             || ' | ' || grantee
             || ' | ' || privilege_type
      from information_schema.role_table_grants
      where table_schema in ('public', 'app')
        and grantee in ('anon', 'authenticated', 'service_role', 'postgres')
      order by 1
    `,
  },
  {
    name: "schema_usage_grants",
    critical: true,
    why: "USAGE on a schema is invisible in table grants and just as load-bearing",
    sql: `
      select n.nspname || ' | ' || r.rolname
             || ' | usage=' || has_schema_privilege(r.rolname, n.nspname, 'USAGE')
             || ' | create=' || has_schema_privilege(r.rolname, n.nspname, 'CREATE')
      from pg_namespace n
      cross join pg_roles r
      where n.nspname in ('public', 'app')
        and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
      order by 1
    `,
  },
  {
    name: "functions",
    critical: true,
    why: "identity AND body -- a function that restored with a different body is worse than one that is missing",
    sql: `
      select n.nspname || '.' || p.proname
             || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             || ' | secdef=' || p.prosecdef
             || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '-')
             || ' | volatile=' || p.provolatile::text
             || ' | body_md5=' || md5(coalesce(p.prosrc, ''))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "function_grants",
    critical: true,
    why: "a SECURITY DEFINER function granted to the wrong role is a privilege escalation, and grants are exactly what --no-privileges drops",
    sql: `
      select n.nspname || '.' || p.proname
             || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             || ' | ' || coalesce(array_to_string(p.proacl::text[], ' '), 'DEFAULT')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "triggers",
    critical: true,
    why: "the fact-immutability and append-only walls in this schema are triggers",
    sql: `
      select n.nspname || '.' || c.relname || ' | ' || t.tgname
             || ' | ' || pg_get_triggerdef(t.oid)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
        and n.nspname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "constraints",
    critical: true,
    why: "CHECK constraints are where the numeric-format and enum invariants live",
    sql: `
      select n.nspname || '.' || c.relname || ' | ' || con.conname
             || ' | ' || pg_get_constraintdef(con.oid)
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "indexes",
    critical: false,
    why: "a missing unique index is a missing invariant; a missing plain index is only slow",
    sql: `
      select schemaname || '.' || tablename || ' | ' || indexname
             || ' | ' || indexdef
      from pg_indexes
      where schemaname in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "sequences",
    critical: false,
    why: "a sequence restored at the wrong value collides on the next insert",
    sql: `
      select sequence_schema || '.' || sequence_name
      from information_schema.sequences
      where sequence_schema in ('public', 'app')
      order by 1
    `,
  },
  {
    name: "extensions",
    critical: false,
    why: "pgcrypto/uuid-ossp absence surfaces as a default that cannot evaluate",
    sql: `
      select extname
      from pg_extension
      order by 1
    `,
  },
];

/**
 * Checks that need only one database. These are the ones worth running
 * against a restored target on its own, because each of them is a way
 * the restore can be broken in a manner no row-count or table-list
 * comparison would reveal.
 */
const SELF_CHECKS = [
  {
    name: "auth_schema_and_helpers_present",
    why: "the direct cause of the 2026-09-03 loss. Asserted POSITIVELY: an earlier version of this check asked 'is any policy referencing a missing auth schema?', which passes vacuously on the broken database precisely because those policies failed to restore",
    sql: `
      select 'MISSING: schema auth'
      where not exists (select 1 from pg_namespace where nspname = 'auth')
      union all
      select 'MISSING: function ' || f.fn
      from (values ('uid'), ('role'), ('jwt')) as f(fn)
      where not exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'auth' and p.proname = f.fn
      )
      union all
      select 'MISSING: table auth.users'
      where not exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relname = 'users' and c.relkind = 'r'
      )
    `,
  },
  {
    name: "auth_user_foreign_keys_present",
    why: "ten product tables reference auth.users. A restore into a target without that table drops all ten silently, and every one of them is a referential-integrity rule the application assumes",
    sql: `
      select 'NO foreign keys reference auth.users -- expected 10'
      where (
        select count(*)
        from pg_constraint con
        join pg_class c on c.oid = con.confrelid
        join pg_namespace n on n.oid = c.relnamespace
        where con.contype = 'f' and n.nspname = 'auth' and c.relname = 'users'
      ) = 0
    `,
  },
  {
    name: "policy_functions_resolve",
    why: "a policy calling app.user_org_ids() is inert if the function did not restore",
    sql: `
      select 'MISSING: app.' || f.fn
      from (values ('user_org_ids'), ('user_is_admin_or_owner_of')) as f(fn)
      where not exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = f.fn
      )
    `,
  },
  {
    name: "tables_without_rls",
    why: "this project's invariant is that every public table has RLS enabled",
    sql: `
      select n.nspname || '.' || c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname = 'public'
        and not c.relrowsecurity
      order by 1
    `,
  },
  {
    name: "rls_without_policies",
    why: "a table with RLS on and zero policies denies everything -- silently, and only at runtime",
    sql: `
      select n.nspname || '.' || c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname = 'public'
        and c.relrowsecurity
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = n.nspname and p.tablename = c.relname
        )
      order by 1
    `,
  },
  {
    name: "tables_without_insert_policy",
    why: "THE standalone form of the 2026-09-03 defect. Five INSERT policies were lost and every other check still passed; a table that can be read but never written is a broken database that looks healthy",
    sql: `
      select n.nspname || '.' || c.relname || ' has RLS and no INSERT policy'
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname = 'public'
        and c.relrowsecurity
        and c.relname not in (
          -- Regulatory reference tables: written only by the data
          -- pipeline running as a privileged role, so no INSERT policy
          -- is the intended state rather than a restore casualty.
          'countries', 'cbam_goods', 'default_emission_values',
          'regulatory_datasets', 'regulatory_sources', 'production_routes',
          -- Written EXCLUSIVELY through SECURITY DEFINER RPCs
          -- (create_organization_with_owner,
          -- accept_organization_invitation, and since 2026-09-03
          -- record_calculation_result), which is why they carry no
          -- INSERT policy for any API role. This is the established
          -- trusted-write pattern in this schema, not an omission.
          --
          -- calculation_results joined this list deliberately: an RLS
          -- policy can pin who is writing and about which line, and
          -- cannot tell a real emissions figure from a forged one,
          -- because the engine that produces it is TypeScript. See
          -- 20260903190000.
          'organizations', 'memberships', 'calculation_results'
        )
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = n.nspname
            and p.tablename = c.relname
            and p.cmd in ('INSERT', 'ALL')
        )
      order by 1
    `,
  },
  {
    name: "api_roles_hold_their_grants",
    why: "catches a --no-privileges restore. Without this, the TRUNCATE check below passes vacuously on a database that has no grants at all -- which is exactly how a broken restore looks",
    sql: `
      select 'role ' || r.rolname || ' holds only '
             || (
               select count(*) from information_schema.role_table_grants g
               where g.table_schema = 'public' and g.grantee = r.rolname
             )::text
             || ' grants in schema public -- privileges did not survive'
      from pg_roles r
      where r.rolname in ('anon', 'authenticated', 'service_role')
        and (
          select count(*) from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.grantee = r.rolname
        ) = 0
      order by 1
    `,
  },
  {
    name: "truncate_granted_to_api_roles",
    why: "the P14 revoke (20260903170000) must survive a restore, and a restore is exactly where a grant silently comes back. Only meaningful alongside api_roles_hold_their_grants above",
    sql: `
      select table_name || ' | ' || grantee
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type = 'TRUNCATE'
      order by 1
    `,
  },
  {
    name: "security_definer_without_search_path",
    why: "a SECURITY DEFINER function with a mutable search_path is a privilege-escalation primitive",
    sql: `
      select n.nspname || '.' || p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app')
        and p.prosecdef
        and (p.proconfig is null
             or not exists (
               select 1 from unnest(p.proconfig) as c(v)
               where c.v like 'search\\_path=%'
             ))
      order by 1
    `,
  },
];

function runQuery(dsn, sql) {
  // Every check returns one text column. Wrapping it and collapsing all
  // whitespace does two things that matter: a policy expression
  // containing newlines stays ONE row (otherwise a single missing
  // multi-line policy reports as four phantom differences and the real
  // count is unreadable), and pure formatting differences between two
  // servers never masquerade as a defect.
  const wrapped =
    `select regexp_replace(x, '[[:space:]]+', ' ', 'g') from (${sql}) as sub(x)`;

  const result =
    spawnSync(
      "psql",
      [dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", wrapped],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

  if (result.error) {
    throw new Error(
      `psql could not be run (${result.error.message}). Is it on PATH?`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `psql exited ${result.status}: ${(result.stderr || "").trim()}`,
    );
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

function diff(source, target) {
  // Multiset difference, so a duplicated row on one side is still a
  // difference. Sorting happened in runQuery.
  const count = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
    return m;
  };

  const s = count(source);
  const t = count(target);

  const onlySource = [];
  const onlyTarget = [];

  for (const [row, n] of s) {
    const extra = n - (t.get(row) ?? 0);
    for (let i = 0; i < extra; i += 1) onlySource.push(row);
  }

  for (const [row, n] of t) {
    const extra = n - (s.get(row) ?? 0);
    for (let i = 0; i < extra; i += 1) onlyTarget.push(row);
  }

  return { onlySource, onlyTarget };
}

function report(label, rows, limit = 20) {
  if (rows.length === 0) return;
  console.log(`    ${label} (${rows.length}):`);
  for (const row of rows.slice(0, limit)) {
    console.log(`      - ${row}`);
  }
  if (rows.length > limit) {
    console.log(`      ... and ${rows.length - limit} more`);
  }
}

function main() {
  const args = process.argv.slice(2);

  const selfOnly = args[0] === "--check";
  const dsns = selfOnly ? args.slice(1) : args;

  if ((selfOnly && dsns.length !== 1) || (!selfOnly && dsns.length !== 2)) {
    console.error(
      "usage: compare-database-posture.mjs <source-dsn> <target-dsn>\n" +
        "       compare-database-posture.mjs --check <dsn>",
    );
    process.exit(2);
  }

  let failures = 0;
  let criticalFailures = 0;

  if (!selfOnly) {
    const [sourceDsn, targetDsn] = dsns;

    console.log("=== Source vs target comparison ===\n");

    for (const check of CHECKS) {
      let sourceRows;
      let targetRows;

      try {
        sourceRows = runQuery(sourceDsn, check.sql);
        targetRows = runQuery(targetDsn, check.sql);
      } catch (error) {
        console.log(`[ERROR] ${check.name}: ${error.message}`);
        failures += 1;
        if (check.critical) criticalFailures += 1;
        continue;
      }

      const { onlySource, onlyTarget } = diff(sourceRows, targetRows);

      if (onlySource.length === 0 && onlyTarget.length === 0) {
        console.log(
          `[MATCH] ${check.name} (${sourceRows.length} rows both sides)`,
        );
        continue;
      }

      failures += 1;
      if (check.critical) criticalFailures += 1;

      console.log(
        `[DIFFER] ${check.name}${check.critical ? " -- CRITICAL" : ""}\n` +
          `    ${check.why}\n` +
          `    source ${sourceRows.length} rows, target ${targetRows.length} rows`,
      );
      report("missing from target", onlySource);
      report("present only in target", onlyTarget);
    }

    console.log("");
  }

  const selfDsn = selfOnly ? dsns[0] : dsns[1];

  console.log(
    `=== Self-consistency checks on ${selfOnly ? "the database" : "the target"} ===\n`,
  );

  for (const check of SELF_CHECKS) {
    let rows;

    try {
      rows = runQuery(selfDsn, check.sql);
    } catch (error) {
      console.log(`[ERROR] ${check.name}: ${error.message}`);
      failures += 1;
      criticalFailures += 1;
      continue;
    }

    if (rows.length === 0) {
      console.log(`[OK] ${check.name}`);
      continue;
    }

    failures += 1;
    criticalFailures += 1;
    console.log(`[FAIL] ${check.name} -- CRITICAL\n    ${check.why}`);
    report("offending rows", rows);
  }

  console.log("");

  if (failures === 0) {
    console.log("RESULT: POSTURE MATCHES");
    process.exit(0);
  }

  console.log(
    `RESULT: POSTURE DIFFERS -- ${failures} check(s) failed, ` +
      `${criticalFailures} of them critical.`,
  );
  console.log(
    "A restore is not proven by tables existing and RLS being on. " +
      "Until every critical check above passes, recovery is unproven.",
  );
  process.exit(1);
}

main();
