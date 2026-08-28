import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  AuditAggregateType,
} from "../../domain/audit/types";

import type {
  OrganizationId,
  UserId,
} from "../../domain/shared/ids";

export interface RecordAuditEventInput {
  orgId: OrganizationId;
  actorUserId: UserId;
  eventType: string;
  aggregateType: AuditAggregateType;
  aggregateId: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Records one audit_events row via the user-scoped client, relying on
 * audit_events_insert_own_org_as_self
 * (20260828150000_p4_shipment_intake_schema.sql) rather than a
 * service-role write or a bespoke SECURITY DEFINER RPC per mutation
 * type -- that policy's WITH CHECK (actor_user_id = auth.uid(), org_id
 * in the caller's own orgs) makes a plain client-side insert safe from
 * forgery, so every use-case service that needs to record an event can
 * share this one helper instead of each wrapping itself in a new RPC.
 *
 * Best-effort by design: a failed audit insert does not roll back or
 * fail the mutation it's describing (the caller already persisted the
 * real change by the time this runs) -- it returns whether it
 * succeeded so a caller can log/surface the gap, but callers should
 * not treat audit recording as a precondition for the mutation itself
 * succeeding. True atomicity (mutation + audit in one transaction)
 * still belongs in a SECURITY DEFINER RPC for the specific cases that
 * genuinely need it, as create_organization_with_owner() already does.
 */
export async function recordAuditEvent(
  supabase: SupabaseClient,
  input: RecordAuditEventInput,
): Promise<{ ok: boolean }> {
  const { error } =
    await supabase
      .from("audit_events")
      .insert(
        {
          org_id: input.orgId,
          actor_type: "USER",
          actor_user_id: input.actorUserId,
          event_type: input.eventType,
          aggregate_type: input.aggregateType,
          aggregate_id: input.aggregateId,
          payload: input.payload ?? {},
          correlation_id: input.correlationId ?? null,
        },
      );

  return {
    ok: !error,
  };
}
