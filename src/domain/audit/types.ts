import type {
  AuditEventId,
  OrganizationId,
  UserId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

export type AuditActor =
  | { type: "USER"; user_id: UserId }
  | { type: "SYSTEM" };

export type AuditAggregateType =
  | "ORGANIZATION"
  | "MEMBERSHIP"
  | "SHIPMENT"
  | "SHIPMENT_LINE"
  | "EMISSION_DATA"
  | "INSTALLATION"
  | "OPERATOR"
  | "SUPPLIER"
  | "SHARING_GRANT"
  | "CALCULATION_RESULT"
  | "DECLARATION"
  | "EVIDENCE_FILE";

/**
 * One immutable entry in the audit trail. `event_type` is a namespaced
 * string (e.g. "shipment.created", "sharing_grant.revoked") — the
 * catalog grows per phase; see docs/architecture, "Auditability" for
 * the currently-defined set. `org_id` is null only for SYSTEM-scope
 * events with no owning organization (e.g. regulatory dataset
 * activation).
 */
export interface AuditEvent {
  id: AuditEventId;
  org_id: OrganizationId | null;
  occurred_at: IsoTimestamp;

  actor: AuditActor;
  event_type: string;

  aggregate: {
    type: AuditAggregateType;
    id: string;
  };

  payload: Record<string, unknown>;
  correlation_id: string | null;
}
