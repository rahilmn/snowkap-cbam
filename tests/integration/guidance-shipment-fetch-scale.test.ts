import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  listDraftShipmentsWithLines,
} from "../../src/application/shipments/list-draft-shipments-with-lines";

/**
 * S2 remediation, B3 (fresh Opus 5 review, 2026-09-05). The review
 * bisected the OLD implementation's single unbounded
 * `.in("shipment_id", allDraftShipmentIds)` request live against this
 * exact local stack and found it fails with HTTP 414 "URI too long"
 * from 220 draft shipments upward -- and below that threshold,
 * PostgREST's own `max_rows` (1000, supabase/config.toml) silently
 * truncated the result instead of erroring. Both failures then
 * surfaced as an affirmative "Nothing needs your attention right now."
 *
 * This is the regression proof at REAL scale against a REAL local
 * Postgres/PostgREST -- the URL-length and max_rows behaviors this test
 * defends against are properties of the real HTTP transport and the
 * real gateway configuration, not something a mocked Supabase client
 * (see list-draft-shipments-with-lines.test.ts's own chunking/
 * pagination unit tests) can reproduce or disprove on its own.
 *
 * Same local-only-instance, skip-not-fail discipline as every other
 * suite under tests/integration/ -- see
 * organizations-isolation.test.ts's header comment for the full
 * rationale.
 */

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function isLocalSupabaseReachable(): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${LOCAL_API_URL}/auth/v1/health`,
        {
          signal:
            AbortSignal.timeout(
              1500,
            ),
        },
      );

    return response.ok;
  } catch {
    return false;
  }
}

const localSupabaseReachable =
  await isLocalSupabaseReachable();

describe.skipIf(!localSupabaseReachable)(
  "listDraftShipmentsWithLines at real scale, beyond the confirmed ~220-shipment failure threshold (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(
        0,
        8,
      );

    const SHIPMENT_COUNT =
      250;

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );

    let orgId: string;

    beforeAll(
      async () => {
        const { data: org, error: orgError } =
          await serviceClient
            .from("organizations")
            .insert(
              {
                name: `Guidance Scale Org ${runId}`,
                slug: `guidance-scale-org-${runId}`,
                capabilities: ["IMPORTER_DECLARANT"],
              },
            )
            .select("id")
            .single();

        if (orgError || !org) {
          throw new Error(
            `Failed to create org: ${orgError?.message}`,
          );
        }

        orgId =
          org.id;

        const shipmentRows =
          Array.from(
            { length: SHIPMENT_COUNT },
            (_, index) => (
              {
                org_id: orgId,
                reference: `SCALE-${runId}-${index}`,
                release_date: "2026-01-15",
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                status: "DRAFT",
              }
            ),
          );

        const { data: insertedShipments, error: shipmentsError } =
          await serviceClient
            .from("shipments")
            .insert(
              shipmentRows,
            )
            .select(
              "id, reference",
            );

        if (shipmentsError || !insertedShipments) {
          throw new Error(
            `Failed to bulk-insert shipments: ${shipmentsError?.message}`,
          );
        }

        const lineRows =
          insertedShipments.map(
            (shipment) => (
              {
                shipment_id: shipment.id,
                org_id: orgId,
                line_number: 1,
                cn_code: "25232100",
                cn_code_level: "CN8",
                origin_country: "CN",
                net_mass_tonnes: "100",
              }
            ),
          );

        const { error: linesError } =
          await serviceClient
            .from("shipment_lines")
            .insert(
              lineRows,
            );

        if (linesError) {
          throw new Error(
            `Failed to bulk-insert shipment_lines: ${linesError.message}`,
          );
        }
      },
    );

    afterAll(
      async () => {
        // Cascades to shipments and shipment_lines
        // (references ... on delete cascade).
        await serviceClient
          .from("organizations")
          .delete()
          .eq(
            "id",
            orgId,
          );
      },
    );

    it(
      `fetches all ${SHIPMENT_COUNT} draft shipments with their lines correctly attached, with no error -- comfortably beyond the confirmed ~220-shipment HTTP 414 threshold`,
      async () => {
        const result =
          await listDraftShipmentsWithLines(
            serviceClient,
            orgId as never,
          );

        expect(result).toHaveLength(
          SHIPMENT_COUNT,
        );

        expect(
          result.every((shipment) => shipment.lines.length === 1),
        ).toBe(
          true,
        );

        // Not just the right COUNT -- the right shipment has its own
        // line, not a neighbour's (a chunking bug could plausibly
        // scramble this while still returning the right totals).
        const first =
          result.find((s) => s.reference === `SCALE-${runId}-0`);

        const last =
          result.find((s) => s.reference === `SCALE-${runId}-${SHIPMENT_COUNT - 1}`);

        expect(first?.lines[0]?.cn_code).toBe(
          "25232100",
        );

        expect(last?.lines[0]?.cn_code).toBe(
          "25232100",
        );

        expect(first?.id).not.toBe(
          last?.id,
        );
      },
    );
  },
);
