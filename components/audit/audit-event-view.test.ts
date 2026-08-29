import {
  describe,
  expect,
  it,
} from "vitest";

import {
  formatActorLabel,
  summarizePayload,
  toAuditEventRowView,
} from "./audit-event-view";

import type {
  AuditEvent,
} from "../../src/domain/audit/types";

describe(
  "formatActorLabel",
  () => {
    it(
      "renders a SYSTEM actor as \"System\" regardless of the email map",
      () => {
        expect(
          formatActorLabel(
            {
              type: "SYSTEM",
            },
            {
              "user-1": "someone@example.com",
            },
          ),
        ).toBe(
          "System",
        );
      },
    );

    it(
      "resolves a USER actor to their email when present in the map",
      () => {
        expect(
          formatActorLabel(
            {
              type: "USER",
              user_id: "user-1" as never,
            },
            {
              "user-1": "alice@snowkap.com",
            },
          ),
        ).toBe(
          "alice@snowkap.com",
        );
      },
    );

    it(
      "falls back to a truncated id when the user has no entry in the map (e.g. removed member)",
      () => {
        expect(
          formatActorLabel(
            {
              type: "USER",
              user_id: "0123456789abcdef" as never,
            },
            {},
          ),
        ).toBe(
          "User 01234567",
        );
      },
    );
  },
);

describe(
  "summarizePayload",
  () => {
    it(
      "returns a placeholder for an empty payload",
      () => {
        expect(
          summarizePayload(
            {},
          ),
        ).toBe(
          "No additional details",
        );
      },
    );

    it(
      "joins scalar fields as key: value pairs in declaration order",
      () => {
        expect(
          summarizePayload(
            {
              reference: "REF-001",
              lineCount: 3,
              locked: false,
            },
          ),
        ).toBe(
          "reference: REF-001, lineCount: 3, locked: false",
        );
      },
    );

    it(
      "drops null and undefined fields rather than printing them",
      () => {
        expect(
          summarizePayload(
            {
              reference: "REF-001",
              note: null,
              tag: undefined,
            },
          ),
        ).toBe(
          "reference: REF-001",
        );
      },
    );

    it(
      "JSON-stringifies a nested object/array field rather than printing [object Object]",
      () => {
        expect(
          summarizePayload(
            {
              scope: { cnCodes: ["7208", "7209"] },
            },
          ),
        ).toBe(
          'scope: {"cnCodes":["7208","7209"]}',
        );
      },
    );

    it(
      "truncates a long summary with an ellipsis rather than dumping it in full",
      () => {
        const longValue =
          "x".repeat(
            200,
          );

        const summary =
          summarizePayload(
            {
              note: longValue,
            },
          );

        expect(
          summary.endsWith(
            "…",
          ),
        ).toBe(
          true,
        );

        expect(
          summary.length,
        ).toBeLessThan(
          longValue.length,
        );
      },
    );
  },
);

describe(
  "toAuditEventRowView",
  () => {
    it(
      "flattens an AuditEvent into the table's row-view shape",
      () => {
        const event: AuditEvent =
          {
            id: "event-1" as never,
            org_id: "org-1" as never,
            occurred_at: "2026-02-01T00:00:00.000Z" as never,
            actor: {
              type: "USER",
              user_id: "user-1" as never,
            },
            event_type: "shipment.created",
            aggregate: {
              type: "SHIPMENT",
              id: "ship-1",
            },
            payload: { reference: "REF-001" },
            correlation_id: null,
          };

        expect(
          toAuditEventRowView(
            event,
            { "user-1": "alice@snowkap.com" },
          ),
        ).toEqual(
          {
            id: "event-1",
            occurredAt: "2026-02-01T00:00:00.000Z",
            eventType: "shipment.created",
            aggregateType: "SHIPMENT",
            aggregateId: "ship-1",
            actorLabel: "alice@snowkap.com",
            payloadSummary: "reference: REF-001",
            payload: { reference: "REF-001" },
          },
        );
      },
    );
  },
);
