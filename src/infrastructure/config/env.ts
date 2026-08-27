import {
  z,
} from "zod";

const supabaseEnvSchema =
  z.object({
    SUPABASE_URL:
      z.string().min(1),

    SUPABASE_SERVICE_ROLE_KEY:
      z.string().min(1),
  });

export type SupabaseEnv =
  z.infer<typeof supabaseEnvSchema>;

/**
 * Validates and returns the Supabase environment variables.
 *
 * Reads from `process.env` by default; a `source` may be supplied for
 * testing. Throws a single error listing every missing/invalid variable
 * rather than failing on the first one, so a misconfigured environment
 * can be fixed in one pass.
 */
export function loadSupabaseEnv(
  source: NodeJS.ProcessEnv = process.env,
): SupabaseEnv {
  const result =
    supabaseEnvSchema.safeParse(
      source,
    );

  if (!result.success) {
    // Build the message from each issue's field path rather than trusting
    // zod's default issue text, which differs between a fully-absent key
    // ("invalid_type") and an empty string ("too_small") — every caller of
    // this function needs the variable name named explicitly either way.
    const missing =
      result.error.issues.map(
        (issue) =>
          `${issue.path.join(".")} is not configured.`,
      );

    throw new Error(
      missing.join(
        " ",
      ),
    );
  }

  return result.data;
}
