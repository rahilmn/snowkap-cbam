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
// (supabase/migrations/20260829500000_..._forgery_fix.sql, replaced
// wholesale by 20260829530000_..._forgery_fix_v2.sql) --
// shipment_lines.emission_determination, the frozen regulatory
// provenance snapshot every "Why this number?" render and filed
// declaration trusts, was unvalidated JSON any org member could forge
// via a direct PostgREST write, with zero audit trail.
//
// This suite's FIRST version (against 20260829500000) was itself found
// to be broken by an independent review: the v1 DB check's method gate
// was inverted (anything that wasn't the literal string "DEFAULT" was
// treated as "skip validation", including a MISSING "method" key --
// while the real calculation engine treats a missing/non-ACTUAL method
// as DEFAULT and computes it), the ACTUAL branch was entirely
// unvalidated, and this suite's own 8th test asserted that gap as
// INTENDED behavior rather than catching it. Every one of those
// findings (F1-F10 in 20260829530000's header comment) was
// independently re-reproduced live via rolled-back psql transactions
// against the real local database before this rewrite, per CLAUDE.md's
// "Adversarial / mutation-oriented testing against local Postgres"
// section -- this file encodes those same reproductions as standing
// regression tests.
//
// Same shape as tests/integration/emission-data-write-hardening.test.ts:
// this suite exercises the RLS policy + trigger layer directly via raw
// supabase-js client calls, never resolve-line-emissions.ts -- it is
// deliberately testing the DB-layer backstop, the wall that stands even
// when the application layer is bypassed entirely.
//
// Uses two REAL, distinct rows from the live ACTIVE regulatory dataset
// (queried dynamically, not hardcoded) rather than fabricated fixture
// data -- default_emission_values is the protected regulatory dataset;
// this suite reads it, never writes to it. A real, freshly-seeded
// VERIFIED emission_data row is used the same way for the ACTUAL-method
// coverage.

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
      // v2 (20260829530000, finding F3) rejects an empty trace -- must
      // be a non-empty array to be accepted at all.
      trace: [{ step: "EXACT_CN8_MATCH", outcome: "RESOLVED" }],
    },
  };
}

interface RealEmissionData {
  id: string;
  verification_status: string;
  verifier_user_id: string;
  emission_unit: string;
  direct_specific: string;
  indirect_specific: string;
}

function actualDeterminationFrom(
  record: RealEmissionData,
): Record<string, unknown> {
  return {
    method: "ACTUAL",
    snapshot: {
      emission_data_id: record.id,
      verification: { status: record.verification_status, verifier_user_id: record.verifier_user_id },
      emission_unit: record.emission_unit,
      values: { direct_specific: record.direct_specific, indirect_specific: record.indirect_specific },
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
    let realEmissionData: RealEmissionData;
    let installationId: string;
    let producerOrgId: string;
    let sharingGrantId: string;

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

      // A REAL, VERIFIED emission_data row for the ACTUAL-method
      // coverage below. The row's owning org is deliberately NOT
      // importerOrgId -- the v2 validator function is SECURITY DEFINER
      // precisely so it verifies "does a real row with these exact
      // values exist" independent of the caller's own RLS visibility
      // (see 20260829530000's header comment); this cross-org setup
      // exercises exactly that.
      const { data: producerOrg, error: producerOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Line Determination Hardening Producer ${runId}`,
              slug: `line-determination-hardening-producer-${runId}`,
              capabilities: ["PRODUCER_OPERATOR"],
            },
          )
          .select("id")
          .single();

      if (producerOrgError || !producerOrg) {
        throw new Error(
          `Failed to create producer org: ${producerOrgError?.message}`,
        );
      }

      const { data: operator, error: operatorError } =
        await serviceClient
          .from("operators")
          .insert(
            {
              org_id: producerOrg.id,
              provenance: "OPERATOR_PROVIDED",
              name: `Hardening Operator ${runId}`,
              country: "IN",
            },
          )
          .select("id")
          .single();

      if (operatorError || !operator) {
        throw new Error(
          `Failed to create operator: ${operatorError?.message}`,
        );
      }

      const { data: installation, error: installationError } =
        await serviceClient
          .from("installations")
          .insert(
            {
              operator_id: operator.id,
              org_id: producerOrg.id,
              provenance: "OPERATOR_PROVIDED",
              name: `Hardening Installation ${runId}`,
              country: "IN",
            },
          )
          .select("id")
          .single();

      if (installationError || !installation) {
        throw new Error(
          `Failed to create installation: ${installationError?.message}`,
        );
      }

      const { data: emissionData, error: emissionDataError } =
        await serviceClient
          .from("emission_data")
          .insert(
            {
              installation_id: installation.id,
              entered_by_org_id: producerOrg.id,
              cn_scope: [recordA.source_trade_code.replace(/\s+/g, "")],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              direct_specific: "0.10",
              indirect_specific: "0.05",
              emission_unit: "TCO2E_PER_TONNE",
              methodology: "EU_METHOD",
              verification_status: "VERIFIED",
              verifier_user_id: memberId,
              status: "ACTIVE",
            },
          )
          .select(
            "id, verification_status, verifier_user_id, emission_unit, direct_specific, indirect_specific",
          )
          .single();

      if (emissionDataError || !emissionData) {
        throw new Error(
          `Failed to create emission_data: ${emissionDataError?.message}`,
        );
      }

      realEmissionData =
        emissionData as RealEmissionData;

      installationId =
        installation.id;

      producerOrgId =
        producerOrg.id;

      // An ACTIVE grant authorizing importerOrgId to reference this
      // installation's emission_data. Required as of 20260829540000
      // (P13 review iteration 3): the validator function closes a
      // cross-tenant boolean-oracle disclosure by requiring the calling
      // org to either own the installation or hold SOME sharing_grants
      // row for it (any status) before it will even compare values --
      // without this row, every ACTUAL-method test below would be
      // rejected regardless of how correct its claimed values are.
      const { data: grant, error: grantError } =
        await serviceClient
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: importerOrgId,
              installation_id: installationId,
              status: "ACTIVE",
              created_by_user_id: memberId,
            },
          )
          .select("id")
          .single();

      if (grantError || !grant) {
        throw new Error(
          `Failed to create sharing grant: ${grantError?.message}`,
        );
      }

      sharingGrantId =
        grant.id;
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
        .from("sharing_grants")
        .delete()
        .eq(
          "grantor_org_id",
          producerOrgId,
        );

      await serviceClient
        .from("emission_data")
        .delete()
        .eq(
          "installation_id",
          installationId,
        );

      await serviceClient
        .from("installations")
        .delete()
        .eq(
          "org_id",
          producerOrgId,
        );

      await serviceClient
        .from("operators")
        .delete()
        .eq(
          "org_id",
          producerOrgId,
        );

      await serviceClient
        .from("organizations")
        .delete()
        .eq(
          "id",
          producerOrgId,
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
      "rejects the exact bypass an earlier version of this fix (20260829500000) let through: a determination with NO \"method\" key at all, carrying a fabricated dataset_version and total -- live-reproduced against 20260829500000 before this suite existed",
      async () => {
        const lineId =
          await insertLine();

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              {
                emission_determination: {
                  resolution: {
                    dataset_id: recordA.dataset_id,
                    dataset_version: "2099-totally-made-up",
                    values: { total: { value: "0.001", status: "AVAILABLE" } },
                  },
                },
              },
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
      "rejects a real record's genuine identity and values paired with a fabricated narrative (wrong country claimed, invented reason, invented trace) -- these render verbatim in \"Why this number?\", exports, and audit payloads",
      async () => {
        const lineId =
          await insertLine();

        const forged =
          determinationFrom(
            recordA,
          );

        (forged.resolution as Record<string, unknown>).country_mapping =
          { status: "MAPPED", regulatory_country_name: "FABRICATED_COUNTRY" };

        (forged.resolution as Record<string, unknown>).reason =
          "TOTALLY_MADE_UP_REASON";

        (forged.resolution as Record<string, unknown>).trace =
          [{ step: "FABRICATED", outcome: "Independently verified" }];

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
      "rejects a determination whose trace is an empty array -- an incomplete resolution narrative must not be accepted as though it were complete",
      async () => {
        const lineId =
          await insertLine();

        const forged =
          determinationFrom(
            recordA,
          );

        (forged.resolution as Record<string, unknown>).trace = [];

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
      "rejects structurally malformed determinations ({} and a bare array) instead of letting them through to crash the calculation engine later",
      async () => {
        const lineForEmpty =
          await insertLine();

        const emptyResult =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: {} },
            )
            .eq(
              "id",
              lineForEmpty,
            );

        expect(emptyResult.error).not.toBeNull();
        expect(emptyResult.error?.code).toBe(
          "42501",
        );

        const lineForArray =
          await insertLine();

        const arrayResult =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: [1, 2, 3] },
            )
            .eq(
              "id",
              lineForArray,
            );

        expect(arrayResult.error).not.toBeNull();
        expect(arrayResult.error?.code).toBe(
          "42501",
        );
      },
    );

    it(
      "rejects a wholesale-fabricated ACTUAL determination -- invented emission_data_id, invented VERIFIED claim, invented values. A prior version of this fix (20260829500000) accepted this unconditionally; independently confirmed via live psql reproduction that it computed a 250x understatement before this fix existed",
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
                  snapshot: {
                    emission_data_id: crypto.randomUUID(),
                    verification: { status: "VERIFIED" },
                    emission_unit: "TCO2E_PER_TONNE",
                    values: { direct_specific: "0.0000001", indirect_specific: "0.0000001" },
                  },
                },
              },
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
      "accepts a genuine ACTUAL determination whose snapshot byte-matches a real, VERIFIED emission_data row from a different org, because an ACTIVE sharing_grants row authorizes it (20260829540000, P13 review iteration 3)",
      async () => {
        const lineId =
          await insertLine();

        const { error } =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: actualDeterminationFrom(realEmissionData) },
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
          (after?.emission_determination as { method: string })
            .method,
        ).toBe(
          "ACTUAL",
        );
      },
    );

    it(
      "rejects a byte-perfect ACTUAL snapshot from an org with NO grant relationship to the installation -- closes the cross-tenant boolean-oracle disclosure 20260829540000 fixes: a SECURITY DEFINER check with no org-scoping would let any org guess a real row's private values by observing accept/reject outcomes",
      async () => {
        const { data: strangerOrg, error: strangerOrgError } =
          await serviceClient
            .from("organizations")
            .insert(
              {
                name: `Line Determination Hardening Stranger ${runId}`,
                slug: `line-determination-hardening-stranger-${runId}`,
                capabilities: ["IMPORTER_DECLARANT"],
              },
            )
            .select("id")
            .single();

        if (strangerOrgError || !strangerOrg) {
          throw new Error(
            `Failed to create stranger org: ${strangerOrgError?.message}`,
          );
        }

        const strangerPassword =
          `line-determination-hardening-stranger-password-${runId}!`;

        const { data: strangerUser, error: strangerUserError } =
          await serviceClient.auth.admin.createUser(
            {
              email: `line-determination-hardening-stranger-${runId}@example.com`,
              password: strangerPassword,
              email_confirm: true,
            },
          );

        if (strangerUserError || !strangerUser.user) {
          throw new Error(
            `Failed to create stranger user: ${strangerUserError?.message}`,
          );
        }

        const { error: strangerMembershipError } =
          await serviceClient
            .from("memberships")
            .insert(
              { org_id: strangerOrg.id, user_id: strangerUser.user.id, role: "OWNER" },
            );

        if (strangerMembershipError) {
          throw new Error(
            `Failed to create stranger membership: ${strangerMembershipError.message}`,
          );
        }

        const { data: strangerShipment, error: strangerShipmentError } =
          await serviceClient
            .from("shipments")
            .insert(
              {
                org_id: strangerOrg.id,
                reference: `LINE-HARDENING-STRANGER-${runId}`,
                release_date: "2026-03-15",
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                status: "DRAFT",
              },
            )
            .select("id")
            .single();

        if (strangerShipmentError || !strangerShipment) {
          throw new Error(
            `Failed to create stranger shipment: ${strangerShipmentError?.message}`,
          );
        }

        const { data: strangerLine, error: strangerLineError } =
          await serviceClient
            .from("shipment_lines")
            .insert(
              {
                shipment_id: strangerShipment.id,
                org_id: strangerOrg.id,
                line_number: 1,
                cn_code: recordA.source_trade_code.replace(/\s+/g, ""),
                cn_code_level: "CN8",
                origin_country: "IN",
                net_mass_tonnes: "10",
                emission_determination: null,
              },
            )
            .select("id")
            .single();

        if (strangerLineError || !strangerLine) {
          throw new Error(
            `Failed to create stranger line: ${strangerLineError?.message}`,
          );
        }

        const clientStranger =
          await signInAnonClient(
            `line-determination-hardening-stranger-${runId}@example.com`,
            strangerPassword,
          );

        try {
          // The exact same byte-perfect snapshot the grant-holding org's
          // positive control above used successfully -- correct
          // emission_data_id, correct verifier_user_id, correct unit,
          // correct direct/indirect values. The ONLY difference is that
          // this org holds no sharing_grants row at all for the
          // installation. Must be rejected identically to a wrong-value
          // guess, so accept/reject never leaks whether the values were
          // actually correct.
          const { error } =
            await clientStranger
              .from("shipment_lines")
              .update(
                { emission_determination: actualDeterminationFrom(realEmissionData) },
              )
              .eq(
                "id",
                strangerLine.id,
              );

          expect(error).not.toBeNull();
          expect(error?.code).toBe(
            "42501",
          );
        } finally {
          await serviceClient
            .from("shipment_lines")
            .delete()
            .eq(
              "org_id",
              strangerOrg.id,
            );

          await serviceClient
            .from("shipments")
            .delete()
            .eq(
              "org_id",
              strangerOrg.id,
            );

          await serviceClient
            .from("memberships")
            .delete()
            .eq(
              "org_id",
              strangerOrg.id,
            );

          await serviceClient
            .from("organizations")
            .delete()
            .eq(
              "id",
              strangerOrg.id,
            );

          await serviceClient.auth.admin.deleteUser(
            strangerUser.user.id,
          );
        }
      },
    );

    it(
      "keeps a previously-valid ACTUAL determination re-savable after its originating grant is REVOKED -- revocation ends future reads, it must not retroactively make an already-correct line unsavable for an unrelated edit (this codebase's own 'revocation never claws back history' design, master plan section 9)",
      async () => {
        const lineId =
          await insertLine();

        const { error: setError } =
          await clientMember
            .from("shipment_lines")
            .update(
              { emission_determination: actualDeterminationFrom(realEmissionData) },
            )
            .eq(
              "id",
              lineId,
            );

        expect(setError).toBeNull();

        const { error: revokeError } =
          await serviceClient
            .from("sharing_grants")
            .update(
              { status: "REVOKED" },
            )
            .eq(
              "id",
              sharingGrantId,
            );

        expect(revokeError).toBeNull();

        try {
          const { error: unrelatedEditError } =
            await clientMember
              .from("shipment_lines")
              .update(
                { net_mass_tonnes: "11" },
              )
              .eq(
                "id",
                lineId,
              );

          expect(unrelatedEditError).toBeNull();
        } finally {
          await serviceClient
            .from("sharing_grants")
            .update(
              { status: "ACTIVE" },
            )
            .eq(
              "id",
              sharingGrantId,
            );
        }
      },
    );

    it(
      "rejects a real emission_data row's identity paired with fabricated values (direct_specific tampered)",
      async () => {
        const lineId =
          await insertLine();

        const forged =
          actualDeterminationFrom(
            realEmissionData,
          );

        (
          (forged.snapshot as Record<string, unknown>).values as Record<string, string>
        ).direct_specific =
          "999.999";

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

        // insertLine seeded the line with recordA's determination
        // already present (via the service client), which -- correctly,
        // per finding F4 -- is itself now audited as an INSERT-time
        // 'set' event. Filter specifically for the 'redetermined' event
        // this test is actually about, rather than assuming this is the
        // only audit row for the line.
        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("event_type, actor_type, actor_user_id, payload")
            .eq(
              "aggregate_id",
              lineId,
            )
            .eq(
              "event_type",
              "shipment_line.updated",
            )
            .eq(
              "payload->>change_kind",
              "redetermined",
            );

        expect(events).toHaveLength(
          1,
        );

        expect(events?.[0]?.actor_type).toBe(
          "USER",
        );

        expect(events?.[0]?.actor_user_id).toBe(
          memberId,
        );

        expect(
          (events?.[0]?.payload as { change_kind: string }).change_kind,
        ).toBe(
          "redetermined",
        );
      },
    );

    it(
      "audits change_kind 'set' the first time a line's determination is written from null, and 'cleared' when it is later wiped -- both under the DB trigger's own shipment_line.updated event_type (distinct from the application's own emission_determination.set/.redetermined names, per finding F10 -- a legitimate determination must not be double-counted on the Audit screen)",
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

        await clientMember
          .from("shipment_lines")
          .update(
            { emission_determination: null },
          )
          .eq(
            "id",
            lineId,
          );

        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("event_type, payload")
            .eq(
              "aggregate_id",
              lineId,
            )
            .eq(
              "event_type",
              "shipment_line.updated",
            )
            .order(
              "occurred_at",
              { ascending: true },
            );

        expect(events).toHaveLength(
          2,
        );

        expect(
          (events?.[0]?.payload as { change_kind: string }).change_kind,
        ).toBe(
          "set",
        );

        expect(
          (events?.[1]?.payload as { change_kind: string }).change_kind,
        ).toBe(
          "cleared",
        );

        // Neither the application's own event names nor a duplicate
        // shipment_line.updated row should appear -- this suite bypasses
        // resolve-line-emissions.ts entirely, so only the DB trigger's
        // own writes should exist.
        const { data: legacyNamedEvents } =
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

        expect(legacyNamedEvents).toHaveLength(
          0,
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
      "audits a genuine INSERT-time determination (a line created already carrying one), not only an UPDATE-time one",
      async () => {
        const { data: inserted, error: insertError } =
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
                emission_determination: determinationFrom(recordA),
              },
            )
            .select("id")
            .single();

        expect(insertError).toBeNull();

        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("event_type, payload")
            .eq(
              "aggregate_id",
              inserted?.id as string,
            )
            .eq(
              "event_type",
              "shipment_line.updated",
            );

        expect(events).toHaveLength(
          1,
        );

        expect(
          (events?.[0]?.payload as { change_kind: string }).change_kind,
        ).toBe(
          "set",
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
            .eq(
              "event_type",
              "shipment_line.updated",
            );

        // The INSERT already carried the determination (audited once,
        // change_kind 'set'), and this UPDATE is a byte-identical no-op
        // -- Postgres's own `is distinct from` correctly treats
        // structurally identical jsonb as unchanged, so no SECOND audit
        // row should exist.
        expect(events).toHaveLength(
          1,
        );
      },
    );

    it(
      "does not crash and attributes actor_type SYSTEM when a determination changes with no end-user session present (a service-role backfill/import/support script)",
      async () => {
        const { data: inserted, error: insertError } =
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
                emission_determination: determinationFrom(recordA),
              },
            )
            .select("id")
            .single();

        expect(insertError).toBeNull();

        const { error: clearError } =
          await serviceClient
            .from("shipment_lines")
            .update(
              { emission_determination: null },
            )
            .eq(
              "id",
              inserted?.id as string,
            );

        expect(clearError).toBeNull();

        const { data: events } =
          await serviceClient
            .from("audit_events")
            .select("actor_type, actor_user_id, payload")
            .eq(
              "aggregate_id",
              inserted?.id as string,
            )
            .eq(
              "event_type",
              "shipment_line.updated",
            )
            .order(
              "occurred_at",
              { ascending: true },
            );

        expect(events).toHaveLength(
          2,
        );

        expect(events?.every((e) => e.actor_type === "SYSTEM")).toBe(
          true,
        );

        expect(events?.every((e) => e.actor_user_id === null)).toBe(
          true,
        );

        expect(
          (events?.[1]?.payload as { change_kind: string }).change_kind,
        ).toBe(
          "cleared",
        );
      },
    );
  },
);
