export type LogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error";

const REDACTED_PLACEHOLDER =
  "[REDACTED]";

/**
 * 2026-08-29 (P11 mandatory security review, NIT N6, promoted to a
 * real fix): this is the SOLE log sink in the codebase (every log-
 * hygiene probe this review ran confirmed no real call site currently
 * passes a secret -- app/api/health/route.ts, the only production
 * call site today, logs only `error.message`) -- but nothing here
 * previously stopped a FUTURE call site from passing one through
 * `fields` and having it written verbatim to stdout, which Railway
 * captures as-is. A deny-list here is cheap (one place, one regex)
 * and permanent, closing the gap before a future caller ever needs to
 * remember to redact it themselves. Matches on the FIELD NAME, not
 * the value -- this module has no way to know a value "looks like" a
 * secret, and pattern-matching values (e.g. "looks like a JWT") is
 * both unreliable and out of scope for a one-line hygiene backstop.
 * `level`/`message`/`time` are never matched (see the reserved-key
 * comment below) -- a caller cannot redact its own log's structure by
 * naming a field "message_password" either, since redaction only
 * applies to keys FROM `fields`, evaluated before the reserved keys
 * are layered on top.
 */
const SENSITIVE_FIELD_NAME_PATTERN =
  /password|passwd|secret|token|authorization|auth_header|credential|api[_-]?key|private[_-]?key|access[_-]?key|refresh_key|encryption_key|signing_key|(?:^|_)key$/i;

function redactSensitiveFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> =
    {};

  for (const [key, value] of Object.entries(fields)) {
    redacted[key] =
      SENSITIVE_FIELD_NAME_PATTERN.test(key)
        ? REDACTED_PLACEHOLDER
        : value;
  }

  return redacted;
}

/**
 * Writes one structured JSON line to stdout via console.log, which
 * Railway (and any container log collector) captures as-is -- no log
 * shipping agent needed for the walking skeleton. See
 * docs/plans/MASTER_PLAN.md §32 ("Observability"): every log line
 * should be filterable/correlatable, which requires structure, not
 * free-text messages.
 *
 * `level`, `message`, and `time` are reserved keys: if `fields`
 * happens to contain any of them, the reserved values always win, so a
 * caller can never accidentally (or via untrusted input) spoof the
 * log's own level or timestamp.
 *
 * Every OTHER field is passed through redactSensitiveFields() first --
 * see that function's own comment above.
 */
export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const payload =
    {
      ...redactSensitiveFields(fields),
      level,
      message,
      time:
        new Date().toISOString(),
    };

  // eslint-disable-next-line no-console -- this IS the log sink.
  console.log(
    JSON.stringify(
      payload,
    ),
  );
}

/**
 * A short, sufficiently-unique per-request identifier for threading a
 * request through logs, audit events, and (from Phase 5 onward)
 * calculation results -- see docs/plans/MASTER_PLAN.md §21/§28
 * ("Request IDs on every action, threaded into logs and audit
 * events"). Uses crypto.randomUUID() (available in the Node/Edge
 * runtimes this app targets) rather than a counter, so it's safe
 * across concurrent requests and multiple server instances without
 * coordination.
 */
export function createRequestId(): string {
  return crypto.randomUUID();
}
