import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildAuditEventsCsv,
} from "./audit-event-csv";

import type {
  AuditEventRowView,
} from "./audit-event-view";

function row(
  overrides: Partial<AuditEventRowView>,
): AuditEventRowView {
  return {
    id: "event-1",
    occurredAt: "2026-02-01T00:00:00.000Z",
    eventType: "shipment.created",
    aggregateType: "SHIPMENT",
    aggregateId: "ship-1",
    actorLabel: "alice@snowkap.com",
    payloadSummary: "reference: REF-001",
    payload: { reference: "REF-001" },
    ...overrides,
  };
}

describe(
  "buildAuditEventsCsv",
  () => {
    it(
      "emits just the header row for an empty list",
      () => {
        expect(
          buildAuditEventsCsv(
            [],
          ),
        ).toBe(
          "Occurred at,Event type,Aggregate type,Aggregate ID,Actor,Payload",
        );
      },
    );

    it(
      "emits one CSV row per audit event, joined with CRLF",
      () => {
        const csv =
          buildAuditEventsCsv(
            [
              row(
                {},
              ),
            ],
          );

        const lines =
          csv.split(
            "\r\n",
          );

        expect(
          lines,
        ).toHaveLength(
          2,
        );

        expect(
          lines[1],
        ).toBe(
          '2026-02-01T00:00:00.000Z,shipment.created,SHIPMENT,ship-1,alice@snowkap.com,"{""reference"":""REF-001""}"',
        );
      },
    );

    it(
      "serializes the full payload as JSON, not the truncated on-screen summary",
      () => {
        const csv =
          buildAuditEventsCsv(
            [
              row(
                {
                  payloadSummary: "reference: REF-001",
                  payload: { reference: "REF-001", note: "kept in full" },
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          '"{""reference"":""REF-001"",""note"":""kept in full""}"',
        );

        expect(
          csv,
        ).not.toContain(
          "reference: REF-001",
        );
      },
    );

    it(
      "quotes and doubles internal quotes for a field containing a comma",
      () => {
        const csv =
          buildAuditEventsCsv(
            [
              row(
                {
                  actorLabel: 'Smith, "Bob"',
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          '"Smith, ""Bob"""',
        );
      },
    );

    it(
      "prefixes a field starting with =, +, -, or @ with a single quote, guarding against CSV formula injection via a registered actor email (P8 security review, finding #6)",
      () => {
        const csv =
          buildAuditEventsCsv(
            [
              row(
                {
                  actorLabel: "=cmd|'/c calc'!A1@evil.com",
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          "'=cmd|'/c calc'!A1@evil.com",
        );
      },
    );

    it(
      "leaves a field with no special characters unquoted",
      () => {
        const csv =
          buildAuditEventsCsv(
            [
              row(
                {
                  eventType: "shipment.created",
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          ",shipment.created,",
        );
      },
    );
  },
);
