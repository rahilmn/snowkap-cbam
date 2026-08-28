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
          { ok: true },
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
          { ok: false },
        );
      },
    );
  },
);
