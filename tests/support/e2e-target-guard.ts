/**
 * Refuse to run the E2E suite against anything but a local Supabase.
 *
 * ------------------------------------------------------------------
 * THE HAZARD (P14, H3)
 *
 * `playwright.config.ts` resolves the app's environment by parsing
 * `.env.local` first and `.env` second, first-file-wins, and hands the
 * result to `webServer.env`. That precedence is correct and matches
 * Next's own.
 *
 * What made it dangerous is what sits in each file on a real machine.
 * `.env` is the file the setup documentation tells a developer to
 * create, and on this project it holds the HOSTED project's URL and
 * service-role key -- `playwright.config.ts`'s own comment calls it
 * "the remote hosted project ... credentials". `.env.local` is the
 * override that points at local Supabase, and nothing required it to
 * exist.
 *
 * So a developer who has followed the setup instructions and not
 * happened to create `.env.local` runs `pnpm test:e2e` and the full
 * MUTATING Playwright suite -- which signs users up, creates
 * organizations and installations, uploads evidence, and files
 * declarations -- executes against the hosted production project, with
 * the production service-role key, and with
 * `DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS=true` so the rate
 * limiters that would otherwise slow it down are off.
 *
 * Nothing warned. The fallback is silent by design, and every URL in
 * the suite is relative.
 *
 * ------------------------------------------------------------------
 * WHY THE RULE IS "DEFINED IN .env.local", NOT "RESOLVES TO LOCALHOST"
 *
 * Checking only that the resolved URL is loopback is not enough. The
 * keys resolve INDEPENDENTLY: `.env.local` can set the two URLs while
 * `SUPABASE_SERVICE_ROLE_KEY` still falls through to `.env`. The suite
 * would then point at local Supabase while the app process holds the
 * PRODUCTION service-role key -- a live credential handed to a process
 * whose whole purpose is to be driven by an automated script.
 *
 * So every key that selects or authenticates a Supabase backend must
 * be defined in `.env.local` itself. Inheriting one of them from `.env`
 * is refused, whatever its value.
 *
 * ------------------------------------------------------------------
 * NO ESCAPE HATCH
 *
 * Deliberately no environment variable that turns this off. An
 * override would be read from the same environment the guard exists to
 * distrust, and the first time someone hit the guard in a hurry it
 * would be exported in a shell profile and never removed. If the E2E
 * suite genuinely needs to run against a remote backend one day, that
 * is a change to this file, reviewed, with the mutating specs
 * addressed -- not a variable.
 */

/**
 * Keys that select or authenticate the Supabase backend the E2E run
 * will talk to. Every one must come from `.env.local`.
 *
 * `APP_URL` is deliberately NOT here: it names the app under test, not
 * a backend, and CI legitimately sets it to the Playwright base URL.
 */
export const E2E_BACKEND_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** The two of those that are URLs, and must point at loopback. */
export const E2E_BACKEND_URL_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
] as const;

export type E2ETargetRefusalReason =
  | "MISSING_ENV_LOCAL"
  | "BACKEND_KEY_NOT_IN_ENV_LOCAL"
  | "NON_LOCAL_BACKEND_URL"
  | "UNPARSEABLE_BACKEND_URL";

export type E2ETargetVerdict =
  | { status: "OK" }
  | {
      status: "REFUSED";
      reason: E2ETargetRefusalReason;
      message: string;
    };

const LOOPBACK_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

export function isLoopbackUrl(value: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return LOOPBACK_HOSTNAMES.has(parsed.hostname);
}

/**
 * @param envLocal parsed `.env.local`, or null when the file is absent
 * @param env      parsed `.env`, used only to explain what would have
 *                 been inherited -- never to satisfy a requirement
 */
export function assertE2ETargetIsLocal(
  envLocal: Record<string, string> | null,
  env: Record<string, string>,
): E2ETargetVerdict {
  if (envLocal === null) {
    return {
      status: "REFUSED",
      reason: "MISSING_ENV_LOCAL",
      message:
        ".env.local is missing, so the E2E suite would fall back to .env -- " +
        "which on this project holds the HOSTED Supabase project's URL and " +
        "service-role key. The suite is mutating: it signs users up, creates " +
        "organizations, uploads evidence and files declarations, with the " +
        "rate limiters disabled. Refusing to start.\n\n" +
        "Create .env.local pointing at your local Supabase (see README's " +
        `"Running the E2E suite"): it must define ${E2E_BACKEND_KEYS.join(", ")}. ` +
        "`pnpm exec supabase status -o env` prints the values.",
    };
  }

  const inherited = E2E_BACKEND_KEYS.filter(
    (key) => envLocal[key] === undefined,
  );

  if (inherited.length > 0) {
    const fromEnv = inherited.filter((key) => env[key] !== undefined);

    return {
      status: "REFUSED",
      reason: "BACKEND_KEY_NOT_IN_ENV_LOCAL",
      message:
        `.env.local does not define ${inherited.join(", ")}. ` +
        (fromEnv.length > 0
          ? `${fromEnv.join(", ")} would be inherited from .env, which holds ` +
            "hosted-project credentials -- so the app under test would run " +
            "with a production key even if the URLs point at local Supabase. "
          : "") +
        "Every key that selects or authenticates the Supabase backend must be " +
        "set in .env.local itself. Refusing to start.",
    };
  }

  for (const key of E2E_BACKEND_URL_KEYS) {
    const value = envLocal[key];

    if (value === undefined || value.trim() === "") {
      return {
        status: "REFUSED",
        reason: "UNPARSEABLE_BACKEND_URL",
        message: `.env.local sets ${key} to an empty value. Refusing to start.`,
      };
    }

    if (!isLoopbackUrl(value)) {
      return {
        status: "REFUSED",
        reason: "NON_LOCAL_BACKEND_URL",
        message:
          `.env.local sets ${key} to ${value}, which is not a loopback ` +
          "address. The E2E suite is mutating and runs with the rate limiters " +
          "disabled; it must never be pointed at a hosted project. Refusing " +
          "to start.",
      };
    }
  }

  return { status: "OK" };
}
