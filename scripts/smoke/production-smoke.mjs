#!/usr/bin/env node

/**
 * Read-only production smoke check.
 *
 * STRICTLY READ-ONLY. Every request here is a GET or a HEAD. Nothing in
 * this file signs in, mutates, or creates anything, and it must stay
 * that way: it is meant to be safe to run against production at any
 * time, including immediately after a deploy, by someone who is not
 * watching it closely.
 *
 * What it is for. After a deploy, the questions an operator actually
 * needs answered are "is this the build I meant to ship", "is it
 * reading the regulatory dataset I meant it to read", and "are the
 * routes still shaped the way they were". A green health endpoint
 * answers none of those on its own: /api/health's
 * active_regulatory_dataset check only ever proved that exactly one
 * active dataset row exists -- never which one, and never whether it
 * held any values.
 *
 * The EXPECTATIONS ARE ARGUMENTS, not constants. The expected commit,
 * dataset version and row count are passed in by the operator running
 * this. Hardcoding them here would put a regulatory expectation in a
 * script nobody re-reads, and would go stale the first time either
 * legitimately changed.
 *
 * Usage:
 *
 *   node scripts/smoke/production-smoke.mjs \
 *     --url https://snowkap-cbam-production.up.railway.app \
 *     --sha <the commit you deployed> \
 *     --dataset-version 2026-definitive-corrected \
 *     --row-count 12540
 *
 * Exits 0 when every check passes, 1 otherwise, and prints one line per
 * check either way -- a check that fails says what it expected and what
 * it got, because "smoke failed" on its own is not actionable.
 */

const args =
  Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (pairs, token, index, tokens) => {
          if (token.startsWith("--")) {
            pairs.push([token.slice(2), tokens[index + 1] ?? ""]);
          }

          return pairs;
        },
        /** @type {[string, string][]} */ ([]),
      ),
  );

const baseUrl =
  (args.url ?? "").replace(/\/+$/, "");

if (!baseUrl) {
  console.error(
    "Missing --url. Nothing is assumed about which deployment to check.",
  );

  process.exit(1);
}

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });

  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`,
  );
}

async function get(path, options = {}) {
  return fetch(
    `${baseUrl}${path}`,
    {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      ...options,
    },
  );
}

// --- health -----------------------------------------------------------
try {
  const response =
    await get("/api/health");

  const body =
    await response.json();

  record(
    "health responds ok",
    response.ok && body.status === "ok",
    `status=${body.status} http=${response.status}`,
  );

  for (const [check, value] of Object.entries(body.checks ?? {})) {
    record(
      `health check ${check}`,
      value === "ok",
      String(value),
    );
  }

  if (args.sha) {
    record(
      "deployed commit is the one expected",
      body.git_sha === args.sha,
      `expected=${args.sha} actual=${body.git_sha}`,
    );
  } else {
    console.log(
      `INFO  deployed commit is ${body.git_sha} (pass --sha to assert it)`,
    );
  }

  // The two facts a green health check never proved on its own.
  if (args["dataset-version"]) {
    record(
      "active regulatory dataset is the one expected",
      body.dataset_version === args["dataset-version"],
      `expected=${args["dataset-version"]} actual=${body.dataset_version}`,
    );
  } else {
    console.log(
      `INFO  active regulatory dataset is ${body.dataset_version} (pass --dataset-version to assert it)`,
    );
  }

  if (args["row-count"]) {
    record(
      "active dataset holds the expected number of value rows",
      String(body.active_row_count) === args["row-count"],
      `expected=${args["row-count"]} actual=${body.active_row_count}`,
    );
  } else {
    console.log(
      `INFO  active dataset holds ${body.active_row_count} value rows (pass --row-count to assert it)`,
    );
  }
} catch (error) {
  record(
    "health responds ok",
    false,
    String(error),
  );
}

// --- liveness ---------------------------------------------------------
try {
  const response =
    await get("/api/live");

  record(
    "liveness responds 200",
    response.status === 200,
    `http=${response.status}`,
  );
} catch (error) {
  record("liveness responds 200", false, String(error));
}

// --- route shape ------------------------------------------------------
//
// Signed out. Asserting the SHAPE of the responses, never their
// contents: a product route that started returning 200 to an anonymous
// caller would be a serious regression, and one that started returning
// 500 would be an outage.
const ROUTE_EXPECTATIONS = [
  { path: "/shipments", expect: [307, 302], note: "product route redirects when signed out" },
  { path: "/emissions", expect: [307, 302], note: "product route redirects when signed out" },
  { path: "/reports", expect: [307, 302], note: "product route redirects when signed out" },
  { path: "/declarations", expect: [307, 302], note: "product route redirects when signed out" },
  { path: "/external-operators", expect: [307, 302], note: "product route redirects when signed out" },
  { path: "/external-emissions", expect: [307, 302], note: "product route redirects when signed out" },
  { path: "/accept-invitation", expect: [307, 302], note: "requires a session" },
  { path: "/onboarding", expect: [307, 302], note: "requires a session" },
  { path: "/sign-in", expect: [200], note: "public" },
  { path: "/auth/confirm", expect: [200], note: "must exist BEFORE the auth templates are pasted" },
  { path: "/design", expect: [404], note: "internal design page must not be public" },
];

for (const route of ROUTE_EXPECTATIONS) {
  try {
    const response =
      await get(route.path);

    record(
      `route ${route.path}`,
      route.expect.includes(response.status),
      `${route.note}; expected ${route.expect.join(" or ")}, got ${response.status}`,
    );
  } catch (error) {
    record(`route ${route.path}`, false, String(error));
  }
}

// --- security headers -------------------------------------------------
try {
  const response =
    await get("/sign-in");

  const expectations = [
    ["strict-transport-security", /max-age=\d+/],
    ["x-content-type-options", /nosniff/i],
    ["x-frame-options", /DENY/i],
    ["referrer-policy", /strict-origin-when-cross-origin/i],
  ];

  for (const [header, pattern] of expectations) {
    const value =
      response.headers.get(header);

    record(
      `header ${header}`,
      value !== null && pattern.test(value),
      value ?? "absent",
    );
  }
} catch (error) {
  record("security headers", false, String(error));
}

// --- summary ----------------------------------------------------------
const failed =
  results.filter((result) => !result.ok);

console.log(
  `\n${results.length - failed.length}/${results.length} checks passed.`,
);

if (failed.length > 0) {
  console.log(
    `\nFailed:\n${failed.map((result) => `  - ${result.name}: ${result.detail}`).join("\n")}`,
  );
}

process.exit(
  failed.length === 0 ? 0 : 1,
);
