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

// Adversarial standing suite for the P13 release-blocker remediation
// (supabase/migrations/20260829500000_p13_review_shipment_line_determination_forgery_fix.sql)
// -- shipment_lines.emission_determination, the frozen regulatory
// provenance snapshot every "Why this number?" render and filed
// declaration trusts, was unvalidated JSON any org member could forge
// via a direct PostgREST write, with zero audit trail. Live-reproduced
// by the P13 final adversarial audit (against a real row this
// migration's own author independently re-reproduced and confirmed
// rejected before writing this suite -- see the migration's own header
// comment). Same shape as tests/integration/emission-data-write-hardening.test.ts:
// this suite exercises the RLS policy + trigger layer directly via raw
// supabase-js client calls, never resolve-line-emissions.ts -- it is
// deliberately testing the DB-layer backstop, the wall that stands even
// when the application layer is bypassed entirely.
//
// Uses two REAL, distinct rows from the live ACTIVE regulatory dataset
// (queried dynamically, not hardcoded) rather than fabricated fixture
// data -- default_emission_values is the protected regulatory dataset;
// this suite reads it, never writes to it.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

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

interface RealRecord {
  dataset_id: string;
  dataset_version: string;
  source_sheet: string;
  source_row: number;
  source_trade_code: string;
  origin_country_name: string;
  source_production_route_code: string | null;
  emission_unit: string;
  direct_value: string;
  direct_status: string;
  indirect_value: string;
  indirect_status: string;
  total_value: string;
  total_status: string;
}

function determinationFrom(
  record: RealRecord,
): Record<string, unknown> {
  return {
    method: "DEFAULT",
    resolution: {
      dataset_id: record.dataset_id,
      dataset_version: record.dataset_version,
      resolved_at: "2026-08-29T00:00:00.000Z",
      reason: "EXACT_CN8_MATCH",
      country_mapping: { status: "MAPPED", regulatory_country_name: record.origin_country_name },
      record_identity: {
        source_sheet: record.source_sheet,
        source_row: record.source_row,
        source_trade_code: record.source_trade_code,
        origin_country_name: record.origin_country_name,
        source_production_route_code: record.source_production_route_code,
      },
      values: {
        direct: { value: record.direct_value, status: record.direct_status, raw_source_value: record.direct_value },
        indirect: { value: record.indirect_value, status: record.indirect_status, raw_source_value: record.indirect_value },
        total: { value: record.total_value, status: record.total_status, raw_source_value: record.total_value },
      },
      emission_unit: record.emission_unit,
      trace: [],
    },
  };
}

describe.skipIf(!localSupabaseReachable)(
  "shipment_lines emission_determination write hardening (P13 release-blocker remediation, local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(
        0,
        8,
      );

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );

    let importerOrgId: string;
    let memberId: string;
    let clientMember: SupabaseClient;

    let shipmentId: string;

    let recordA: RealRecord;
    let recordB: RealRecord;

    async function signInAnonClient(
      email: string,
      password: string,
    ): Promise<SupabaseClient> {
      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          {
            auth: { persistSession: false },
          },
        );

      const { error } =
        await client.auth.signInWithPassword(
          {
            email,
            password,
          },
        );

      if (error) {
        throw new Error(
          `Failed to sign in test user ${email}: ${error.message}`,
        );
      }

      return client;
    }

    async function insertLine(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const { data, error } =
        await serviceClient
          .from("shipment_lines")
          .insert(
            {
              shipment_id: shipmentId,
              org_id: importerOrgId,
              line_number: Math.floor(
                Math.random() * 1_000_000,
              ),
              cn_code: recordA.source_trade_code.replace(/\s+/g, ""),
              cn_code_level: "CN8",
              origin_country: "IN",
              net_mass_tonnes: "10",
              emission_determination: null,
              ...overrides,
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to seed shipment_line: ${error?.message}`,
        );
      }

      return data.id as string;
    }

    beforeAll(async () => {
      // Two REAL, distinct rows from the live ACTIVE dataset -- fetched
      // dynamically so this suite stays correct across a future dataset
      // reload, rather than hardcoding today's specific values.
      const { data: candidates, error: candidatesError } =
        await serviceClient
          .from("default_emission_values")
          .select(
            "dataset_id, source_sheet, source_row, source_trade_code, total_value, total_status, direct_value, direct_status, indirect_value, indirect_status, emission_unit, production_route_id, countries!inner(name), regulatory_datasets!inner(version)",
          )
          .eq(
            "total_status",
            "AVAILABLE",
          )
          .is(
            "production_route_id",
            null,
          )
          .limit(50);

      if (candidatesError || !candidates || candidates.length < 2) {
        throw new Error(
          `Failed to fetch real regulatory candidates: ${candidatesError?.message}`,
        );
      }

      function toRealRecord(
        row: NonNullable<typeof candidates>[number],
      ): RealRecord {
        const countries =
          row.countries as unknown as { name: string };

        const datasets =
          row.regulatory_datasets as unknown as { version: string };

        return {
          dataset_id: row.dataset_id,
          dataset_version: datasets.version,
          source_sheet: row.source_sheet,
          source_row: row.source_row,
          source_trade_code: row.source_trade_code,
          origin_country_name: countries.name,
          source_production_route_code: null,
          emission_unit: row.emission_unit,
          direct_value: row.direct_value,
          direct_status: row.direct_status,
          indirect_value: row.indirect_value,
          indirect_status: row.indirect_status,
          total_value: row.total_value,
          total_status: row.total_status,
        };
      }

      recordA =
        toRealRecord(
          candidates[0]!,
        );

      // Pick a second candidate with a genuinely different total value,
      // so a test substituting A's determination for B's is provably a
      // real change, not a same-value no-op.
      const secondRaw =
        candidates.find(
          (c) => c.total_value !== candidates[0]!.total_value,
        );

      if (!secondRaw) {
        throw new Error(
          "Could not find two distinct-valued regulatory candidates in the ACTIVE dataset.",
        );
      }

      recordB =
        toRealRecord(
          secondRaw,
        );

      const { data: importerOrg, error: importerOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Line Determination Hardening Importer ${runId}`,
              slug: `line-determination-hardening-importer-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (importerOrgError || !importerOrg) {
        throw new Error(
          `Failed to create importer org: ${importerOrgError?.message}`,
        );
      }

      importerOrgId = importerOrg.id;

      const password =
        `line-determination-hardening-password-${runId}!`;

      const { data: memberUser, error: memberUserError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `line-determination-hardening-member-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (memberUserError || !memberUser.user) {
        throw new Error(
          `Failed to create member user: ${memberUserError?.message}`,
        );
      }

      memberId = memberUser.user.id;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            { org_id: importerOrgId, user_id: memberId, role: "MEMBER" },
          );

      if (membershipError) {
        throw new Error(
          `Failed to create membership: ${membershipError.message}`,
        );
      }

      clientMember =
        await signInAnonClient(
          `line-determination-hardening-member-${runId}@example.com`,
          password,
        );

      const { data: shipment, error: shipmentError } =
        await serviceClient
          .from("shipments")
          .insert(
            {
              org_id: importerOrgId,
              reference: `LINE-HARDENING-${runId}`,
              release_date: "2026-03-15",
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              status: "DRAFT",
            },
          )
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(
          `Failed to create shipment: ${shipmentError?.message}`,
        );
      }

      shipmentId = shipment.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("audit_events")
        .delete()
        .eq(
          "org_id",
          importerOrgId,
        );

      await serviceClient
        .from("shipment_lines")
        .delete()
        .eq(
          "org_id",
          importerOrgId,
        );

      await serviceClient
        .from("shipments")
        .delete()
        .eq(
          "org_id",
          importerOrgId,
        );

      await serviceClient
        .from("memberships")
        .delete()
        .eq(
          "org_id",
          importerOrgId,
        );

      await serviceClient
        .from("organizations")
        .delete()
        .eq(
          "id",
          importerOrgId,
        );

      await serviceClient.auth.admin.deleteUser(
        memberId,
      );
    });

    it(
      "accepts a genuine determination whose values byte-match a real default_emission_values row",
      async () => {
        const lineId =
          await insertLine();

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: determinationFrom(recordA) },
            )
            .eq(
              "id",
              lineId,
            );

        expect(error).toBeNull();

        const { data: after } =
          await serviceClient
            .from("shipment_lines")
            .select("emission_determination")
            .eq(
              "id",
              lineId,
            )
            .single();

        expect(
          (after?.emission_determination as { resolution: { values: { total: { value: string } } } })
            .resolution.values.total.value,
        ).toBe(
          recordA.total_value,
        );
      },
    );

    it(
      "rejects a fabricated total value that does not match any real regulatory record -- the exact shape the P13 audit live-reproduced (dataset_version '2099-totally-made-up', total '0.001')",
      async () => {
        const lineId =
          await insertLine(
            { emission_determination: determinationFrom(recordA) },
          );

        const forged =
          determinationFrom(
            recordA,
          );

        (forged.resolution as Record<string, unknown>).dataset_version =
          "2099-totally-made-up";

        (
          (forged.resolution as Record<string, unknown>).values as Record<string, { value: string }>
        ).total.value =
          "0.001";

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: forged },
            )
            .eq(
              "id",
              lineId,
            );

        expect(error).not.toBeNull();
        expect(error?.code).toBe(
          "42501",
        );

        const { data: after } =
          await serviceClient
            .from("shipment_lines")
            .select("emission_determination")
            .eq(
              "id",
              lineId,
            )
            .single();

        expect(
          (after?.emission_determination as { resolution: { dataset_version: string } })
            .resolution.dataset_version,
        ).toBe(
          recordA.dataset_version,
        );
      },
    );

    it(
      "rejects a real record's own values pasted under a completely invented record_identity",
      async () => {
        const lineId =
          await insertLine(
            { emission_determination: determinationFrom(recordA) },
          );

        const forged =
          determinationFrom(
            recordA,
          );

        (forged.resolution as Record<string, unknown>).record_identity =
          {
            source_sheet: "Nonexistent Sheet",
            source_row: 999999,
            source_trade_code: recordA.source_trade_code,
            origin_country_name: recordA.origin_country_name,
            source_production_route_code: null,
          };

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: forged },
            )
            .eq(
              "id",
              lineId,
            );

        expect(error).not.toBeNull();
        expect(error?.code).toBe(
          "42501",
        );
      },
    );

    it(
      "accepts a genuine redetermination to a different real regulatory record, and the change is unbypassably audited (attributed to the actual caller, not a system actor)",
      async () => {
        const lineId =
          await insertLine(
            { emission_determination: determinationFrom(recordA) },
          );

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: determinationFrom(recordB) },
            )
            .eq(
              "id",
              lineId,
            );

        expect(error).toBeNull();

        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("event_type, actor_user_id, aggregate_id")
            .eq(
              "aggregate_id",
              lineId,
            )
            .eq(
              "event_type",
              "emission_determination.redetermined",
            );

        expect(events).toHaveLength(
          1,
        );

        expect(events?.[0]?.actor_user_id).toBe(
          memberId,
        );
      },
    );

    it(
      "writes emission_determination.set (not .redetermined) the first time a line's determination is written from null",
      async () => {
        const lineId =
          await insertLine();

        await clientMember
          .from("shipment_lines")
          .update(
            { emission_determination: determinationFrom(recordA) },
          )
          .eq(
            "id",
            lineId,
          );

        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("event_type")
            .eq(
              "aggregate_id",
              lineId,
            )
            .eq(
              "event_type",
              "emission_determination.set",
            );

        expect(events).toHaveLength(
          1,
        );
      },
    );

    it(
      "rejects a forged determination at INSERT time too, not only on UPDATE",
      async () => {
        const forged =
          determinationFrom(
            recordA,
          );

        (
          (forged.resolution as Record<string, unknown>).values as Record<string, { value: string }>
        ).total.value =
          "999999";

        const { error } =
          await clientMember
            .from("shipment_lines")
            .insert(
              {
                shipment_id: shipmentId,
                org_id: importerOrgId,
                line_number: Math.floor(
                  Math.random() * 1_000_000,
                ),
                cn_code: recordA.source_trade_code.replace(/\s+/g, ""),
                cn_code_level: "CN8",
                origin_country: "IN",
                net_mass_tonnes: "10",
                emission_determination: forged,
              },
            );

        expect(error).not.toBeNull();
        expect(error?.code).toBe(
          "42501",
        );
      },
    );

    it(
      "does not audit a no-op write that leaves emission_determination unchanged",
      async () => {
        const lineId =
          await insertLine(
            { emission_determination: determinationFrom(recordA) },
          );

        await clientMember
          .from("shipment_lines")
          .update(
            { emission_determination: determinationFrom(recordA) },
          )
          .eq(
            "id",
            lineId,
          );

        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("event_type")
            .eq(
              "aggregate_id",
              lineId,
            )
            .in(
              "event_type",
              ["emission_determination.set", "emission_determination.redetermined"],
            );

        // The INSERT already carried the determination (no trigger fires
        // on INSERT), and this UPDATE is a byte-identical no-op --
        // Postgres's own `is distinct from` correctly treats structurally
        // identical jsonb as unchanged, so no audit row should exist.
        expect(events).toHaveLength(
          0,
        );
      },
    );

    it(
      "leaves an ACTUAL-method determination alone -- this migration's content check is DEFAULT-only, ACTUAL integrity is emission_data's own anti-join's job",
      async () => {
        const lineId =
          await insertLine();

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              {
                emission_determination: {
                  method: "ACTUAL",
                  emission_data_id: crypto.randomUUID(),
                  snapshot: { anything: "goes-here-for-this-test" },
                },
              },
            )
            .eq(
              "id",
              lineId,
            );

        expect(error).toBeNull();
      },
    );
  },
);
