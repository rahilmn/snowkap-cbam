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
 * Deliberately narrower than NodeJS.ProcessEnv: this function only
 * ever reads the two keys below, so it should not require every field
 * a full process environment happens to carry. (Next.js's own type
 * declarations globally augment NodeJS.ProcessEnv to require NODE_ENV
 * -- see next/types/global.d.ts -- which would otherwise force every
 * test fixture calling this function to fabricate an unrelated field.)
 */
export type SupabaseEnvSource = Partial<
  Record<
    "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY",
    string | undefined
  >
>;

/**
 * Validates and returns the Supabase environment variables.
 *
 * Reads from `process.env` by default; a `source` may be supplied for
 * testing. Throws a single error listing every missing/invalid variable
 * rather than failing on the first one, so a misconfigured environment
 * can be fixed in one pass.
 */
export function loadSupabaseEnv(
  // The cast is safe: process.env structurally satisfies
  // SupabaseEnvSource (it may carry many other keys, which is fine --
  // this parameter only narrows which keys the FUNCTION cares about,
  // not which keys the argument is allowed to have) but TypeScript's
  // default-parameter assignability check does not see that through
  // NodeJS.ProcessEnv's own (unrelated, Next.js-augmented) shape.
  source: SupabaseEnvSource = process.env as SupabaseEnvSource,
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
