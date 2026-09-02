export type AppUrlStatus =
  | "ok"
  | "missing"
  | "not_required";

/**
 * 2026-08-31 (P13 Bucket C/D sweep, upgraded to HIGH on verification).
 *
 * `getAppOrigin()` (app/team/actions.ts) builds the redirect URL for
 * EVERY transactional auth email this product sends -- sign-up
 * confirmation, password reset, and team invitation. It prefers
 * `APP_URL`, and when that is unset it falls back to
 * `http://localhost:3000` for any host it does not recognise as local.
 *
 * That fallback is CORRECT and must not be removed: it is the fail-safe
 * half of the P11 host-header-injection fix, which deliberately refuses
 * to trust an attacker-suppliable `x-forwarded-host` when building a
 * link that gets emailed to a user. The repository's own regression test
 * pins that behaviour (`app/team/actions.test.ts`, "falls back to the
 * safe default rather than trusting an untrusted x-forwarded-host").
 *
 * The gap is that nothing supplied the authoritative value in
 * production, and nothing NOTICED. A Railway deploy without `APP_URL`
 * emails `http://localhost:3000/auth/callback?...` to every real user
 * -- confirmation, reset and invitation all broken -- while
 * `/api/health` happily reported `"ok"`, because it checked the
 * database, the regulatory dataset and the product schema, and nothing
 * about configuration.
 *
 * So this check exists to make a silent misconfiguration loud. It is
 * pure and free: one environment read, no I/O.
 *
 * `not_required` outside production is deliberate rather than
 * `"ok"`-by-default: locally, the localhost fallback is the genuinely
 * right answer (that IS the origin), so reporting a hard "ok" would
 * imply a configuration that does not exist, and reporting "missing"
 * would make every developer's health check red for no reason.
 */
export interface AppUrlCheck {
  status: AppUrlStatus;
}

export function checkAppUrl(
  env: Record<string, string | undefined> = process.env,
): AppUrlCheck {
  // Trimmed, and empty-treated-as-unset, for the same reason
  // resolve-git-sha.ts does it: a set-but-empty Railway variable is a
  // real, observed failure mode, and `??` would treat "" as configured.
  const appUrl =
    env.APP_URL?.trim();

  if (appUrl) {
    return {
      status: "ok",
    };
  }

  if (env.NODE_ENV === "production") {
    return {
      status: "missing",
    };
  }

  return {
    status: "not_required",
  };
}
