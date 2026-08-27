export type LogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error";

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
 */
export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const payload =
    {
      ...fields,
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
