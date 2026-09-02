/**
 * GoTrue reports a failed email-link verification by redirecting BACK to
 * the app with the failure in the URL rather than by returning an error
 * to any code this product runs. Until 2026-09-03 nothing here read those
 * parameters at all, so every failure -- expired token, spent token, rate
 * limit, PKCE mismatch -- rendered the same single sentence.
 *
 * The parameters arrive in the HASH FRAGMENT for an implicit-flow link
 * and, for a PKCE-flow token, additionally in the QUERY STRING. The hash
 * is checked first because it is the shape GoTrue always produces; the
 * query is the supplementary one.
 *
 * `error_code` is preferred over `error` because it is the machine value
 * (`otp_expired`); `error` carries the coarser OAuth-style bucket
 * (`access_denied`) and is only a fallback.
 *
 * Note what this returns and what it does not: the code and the raw type,
 * never `error_description`. That description is attacker-controllable
 * text arriving on a trusted origin, and describeAuthLinkError maps only
 * known codes to copy written in the repository.
 */
export interface ParsedAuthLinkError {
  code: string;
  type: string | null;
}

function readFrom(
  raw: string,
): ParsedAuthLinkError | null {
  const params =
    new URLSearchParams(
      raw.replace(
        /^[#?]/,
        "",
      ),
    );

  const code =
    params.get(
      "error_code",
    ) ??
    params.get(
      "error",
    );

  if (!code) {
    return null;
  }

  return {
    code,
    type:
      params.get(
        "type",
      ),
  };
}

export function parseAuthLinkError(
  hash: string,
  search: string,
): ParsedAuthLinkError | null {
  return (
    readFrom(
      hash,
    ) ??
    readFrom(
      search,
    )
  );
}
