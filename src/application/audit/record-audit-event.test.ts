import {
  describe,
  expect,
  it,
} from "vitest";

import {
  recordAuditEvent,
} from "./record-audit-event";

function mockSupabase(
  insertError: unknown = null,
) {
  let capturedPayload:
    unknown;

  return {
    client: {
      from: () => (
        {
          insert: (
            payload: unknown,
          ) => {
            capturedPayload =
              payload;

            return Promise.resolve(
              { error: insertError },
            );
          },
        }
      ),
    } as never,

    getCapturedPayload: () =>
      capturedPayload,
  };
}

describe(
  "recordAuditEvent",
  () => {
    it(
      "inserts with the actor/org/event fields mapped correctly",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        const result =
          await recordAuditEvent(
            client,
            {
              orgId: "org-1" as never,
              actorUserId: "user-1" as never,
              eventType: "shipment.created",
              aggregateType: "SHIPMENT",
              aggregateId: "ship-1",
              payload: { reference: "REF-001" },
            },
          );

        expect(result).toEqual(
          { ok: true, reason: null },
        );

        expect(getCapturedPayload()).toEqual(
          {
            org_id: "org-1",
            actor_type: "USER",
            actor_user_id: "user-1",
            event_type: "shipment.created",
            aggregate_type: "SHIPMENT",
            aggregate_id: "ship-1",
            payload: { reference: "REF-001" },
            correlation_id: null,
          },
        );
      },
    );

    it(
      "defaults payload to {} and correlation_id to null when omitted",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        await recordAuditEvent(
          client,
          {
            orgId: "org-1" as never,
            actorUserId: "user-1" as never,
            eventType: "shipment_line.removed",
            aggregateType: "SHIPMENT_LINE",
            aggregateId: "line-1",
          },
        );

        expect(getCapturedPayload()).toMatchObject(
          {
            payload: {},
            correlation_id: null,
          },
        );
      },
    );

    it(
      "returns ok: false when the insert errors, without throwing",
      async () => {
        const { client } =
          mockSupabase(
            { message: "denied" },
          );

        const result =
          await recordAuditEvent(
            client,
            {
              orgId: "org-1" as never,
              actorUserId: "user-1" as never,
              eventType: "shipment.created",
              aggregateType: "SHIPMENT",
              aggregateId: "ship-1",
            },
          );

        expect(result).toEqual(
          { ok: false, reason: expect.any(String) },
        );
      },
    );
  },
);

describe(
  "recordAuditEvent payload bounds (P13 remaining-findings review, 2026-08-31)",
  () => {
    it(
      "refuses an oversize payload without attempting the insert",
      async () => {
        // Wall 1 of two. Wall 2 is
        // 20260831140000_p13_review_audit_events_payload_bounds.sql's
        // audit_events_payload_size_ck, which is the one that actually
        // stops a direct PostgREST insert -- this guard exists so the
        // application fails deterministically and identically rather
        // than discovering the bound as an opaque constraint error.
        const { client, getCapturedPayload } =
          mockSupabase();

        const result =
          await recordAuditEvent(
            client,
            {
              orgId: "org-1" as never,
              actorUserId: "user-1" as never,
              eventType: "shipment.created",
              aggregateType: "SHIPMENT",
              aggregateId: "ship-1",
              payload: { filler: "x".repeat(9000) },
            },
          );

        expect(result).toEqual(
          { ok: false, reason: expect.any(String) },
        );

        // Never reached the database.
        expect(getCapturedPayload()).toBeUndefined();
      },
    );

    it(
      "still accepts a payload comfortably under the bound",
      async () => {
        const { client } =
          mockSupabase();

        const result =
          await recordAuditEvent(
            client,
            {
              orgId: "org-1" as never,
              actorUserId: "user-1" as never,
              eventType: "shipment.created",
              aggregateType: "SHIPMENT",
              aggregateId: "ship-1",
              // The largest payload this application has ever actually
              // written in production is 390 bytes (measured across 27
              // rows, 2026-08-31); this is larger than that and still
              // far under the 8192 bound.
              payload: { filler: "x".repeat(1000) },
            },
          );

        expect(result).toEqual(
          { ok: true, reason: null },
        );
      },
    );
  },
);
