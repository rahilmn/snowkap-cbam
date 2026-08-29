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
  computeDeclarationDraftFacts,
} from "../../src/application/declarations/compute-declaration-draft-facts";

import {
  listPeriodShipmentLines,
} from "../../src/application/reporting/list-period-shipment-lines";

import {
  buildPeriodSummary,
} from "../../src/application/reporting/build-period-summary";

// Standing suite for P9's declarations table, its RLS, and
// public.record_declaration_filed()
// (20260829330000_p9_declarations_schema.sql), extending the same
// pattern as tests/integration/organizations-isolation.test.ts (see that
// file's header for the local-only-instance rationale, the fixed local
// demo JWTs -- not secrets -- and the skip-not-fail discipline) and
// tests/integration/sharing-grants-isolation.test.ts (a lifecycle table
// whose sensitive transition is RPC-only).
//
// Every case here is a real end-to-end exercise against local Postgres,
// not a mock: the RLS composition argument in that migration's header
// comment ("exactly ONE update policy, on purpose") is the kind of claim
// this codebase has already twice found to be wrong when only reasoned
// about statically -- 20260828110000's infinite recursion and
// 20260829300000's BLOCKING forged-acceptance bypass were both found by
// running the thing, not by reading it. The three cases the P9 workstream
// named as mandatory (a MEMBER cannot INSERT or file; a bare UPDATE
// cannot reach FILED_RECORDED or write the filed_* columns; filing really
// does LOCK every member shipment and freeze a snapshot) are here, plus
// the adversarial variants that would make them hollow if omitted -- an
// INSERT that arrives already FILED_RECORDED, and a second ANNUAL
// original for a period whose null quarter would slip past a bare
// four-column unique index.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/**
 * The three per-line embedded-emissions figures the happy-path
 * declaration aggregates. Chosen so the exact expected total is
 * unreachable by any implementation that rounds, truncates, or routes a
 * regulated numeric through a JavaScript `number`: 1e-23 vanishes
 * entirely under IEEE-754 double addition against 3.75, and any
 * declaration-time rounding to whole tonnes (Implementing Regulation
 * (EU) 2025/2547 Annex II point A.1(6)) or to 5 decimals (point A.1(8))
 * would collapse it too. RULE-EE-006 escalates the rounding METHOD as an
 * unresolved regulatory gap, so filed_snapshot must carry full precision
 * -- this fixture is what makes "no rounding is applied" an assertion
 * rather than a comment.
 */
const LINE_EMISSIONS =
  [
    "1.5",
    "2.25",
    "0.00000000000000000000001",
  ] as const;

const EXPECTED_TOTAL_TCO2E =
  "3.75000000000000000000001";

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

interface RpcResultRow {
  result_status: string;
  result_declaration_id: string | null;
}

describe.skipIf(!localSupabaseReachable)(
  "declarations RLS + record_declaration_filed (local Supabase only)",
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

    let orgAId: string;
    let orgBId: string;

    let ownerAId: string;
    let memberAId: string;
    let ownerBId: string;

    let clientOwnerA: SupabaseClient;
    let clientMemberA: SupabaseClient;
    let clientOwnerB: SupabaseClient;

    // Two fully-calculated member shipments for the happy path, plus one
    // whose single line has no calculation_results row at all (the
    // INCOMPLETE case).
    let shipmentOneId: string;
    let shipmentTwoId: string;
    let shipmentUncalculatedId: string;

    let declarationMainId: string;
    let declarationDraftId: string;
    let declarationIncompleteId: string;

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

    /**
     * Creates a DRAFT shipment with one line per supplied emissions
     * figure, each line carrying a real calculation_results row inserted
     * through the OWNER's own authenticated client (so
     * calculation_results_insert_own_org_as_self, 20260829200000, is
     * genuinely exercised rather than bypassed via service role), then
     * marks the shipment READY. Passing an empty array produces a
     * shipment with one line and no calculation at all -- the state
     * record_declaration_filed must refuse rather than sum as zero.
     */
    async function seedShipment(
      reference: string,
      emissions: readonly string[],
      // Defaults to the suite's own main 2026 period -- every EXISTING
      // call site relies on that default. Overridable so a test that
      // needs its own uncontested period (nothing else in this suite
      // touches it) doesn't have to reason about shipmentOne/shipmentTwo's
      // own later transitions (LOCKED after the "OK" filing test runs)
      // to make an assertion about "every shipment in this period" hold.
      year: number = 2026,
    ): Promise<string> {
      const { data: shipment, error: shipmentError } =
        await clientOwnerA
          .from("shipments")
          .insert(
            {
              org_id: orgAId,
              reference,
              release_date: "2026-03-15",
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
            },
          )
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(
          `Failed to create shipment ${reference}: ${shipmentError?.message}`,
        );
      }

      const lineCount =
        Math.max(
          emissions.length,
          1,
        );

      for (let index = 0; index < lineCount; index += 1) {
        const { data: line, error: lineError } =
          await clientOwnerA
            .from("shipment_lines")
            .insert(
              {
                shipment_id: shipment.id,
                org_id: orgAId,
                line_number: index + 1,
                cn_code: "72081000",
                cn_code_level: "CN8",
                origin_country: "IN",
                net_mass_tonnes: "10",
                emission_determination: {
                  method: "DEFAULT",
                  resolution: {
                    dataset_version: "2026.1",
                    reason: "EXACT_TRADE_CODE_MATCH",
                  },
                },
              },
            )
            .select("id")
            .single();

        if (lineError || !line) {
          throw new Error(
            `Failed to create line ${index + 1} of ${reference}: ${lineError?.message}`,
          );
        }

        const emission =
          emissions[index];

        if (emission === undefined) {
          continue;
        }

        const { error: resultError } =
          await clientOwnerA
            .from("calculation_results")
            .insert(
              {
                org_id: orgAId,
                line_id: line.id,
                shipment_id: shipment.id,
                engine_version: "1.1.0",
                quantity: "10",
                quantity_unit: "TONNES",
                determination: {
                  method: "DEFAULT",
                  resolution: {
                    dataset_version: "2026.1",
                    reason: "EXACT_TRADE_CODE_MATCH",
                  },
                },
                steps: [],
                embedded_emissions_tco2e: emission,
                calculated_by_user_id: ownerAId,
              },
            );

        if (resultError) {
          throw new Error(
            `Failed to create calculation result for ${reference}: ${resultError.message}`,
          );
        }
      }

      const { error: readyError } =
        await clientOwnerA
          .from("shipments")
          .update(
            { status: "READY" },
          )
          .eq(
            "id",
            shipment.id,
          );

      if (readyError) {
        throw new Error(
          `Failed to mark ${reference} READY: ${readyError.message}`,
        );
      }

      return shipment.id;
    }

    async function createDeclaration(
      year: number,
      memberShipmentIds: string[],
      status: "DRAFT" | "READY",
    ): Promise<string> {
      const { data, error } =
        await clientOwnerA
          .from("declarations")
          .insert(
            {
              org_id: orgAId,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              member_shipment_ids: memberShipmentIds,
              completeness_report: { blockers: [] },
              created_by_user_id: ownerAId,
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to create ${year} declaration: ${error?.message}`,
        );
      }

      if (status === "READY") {
        const { error: readyError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { status: "READY" },
            )
            .eq(
              "id",
              data.id,
            );

        if (readyError) {
          throw new Error(
            `Failed to mark ${year} declaration READY: ${readyError.message}`,
          );
        }
      }

      return data.id;
    }

    beforeAll(async () => {
      const { data: orgA, error: orgAError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Declarations Isolation Org A ${runId}`,
              slug: `declarations-isolation-org-a-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (orgAError || !orgA) {
        throw new Error(
          `Failed to create org A: ${orgAError?.message}`,
        );
      }

      orgAId = orgA.id;

      const { data: orgB, error: orgBError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Declarations Isolation Org B ${runId}`,
              slug: `declarations-isolation-org-b-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (orgBError || !orgB) {
        throw new Error(
          `Failed to create org B: ${orgBError?.message}`,
        );
      }

      orgBId = orgB.id;

      const password =
        `declarations-isolation-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `declarations-isolation-${label}-${runId}@example.com`,
              password,
              email_confirm: true,
            },
          );

        if (error || !data.user) {
          throw new Error(
            `Failed to create ${label}: ${error?.message}`,
          );
        }

        return data.user.id;
      }

      ownerAId = await createUser("owner-a");
      memberAId = await createUser("member-a");
      ownerBId = await createUser("owner-b");

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: orgAId, user_id: ownerAId, role: "OWNER" },
              { org_id: orgAId, user_id: memberAId, role: "MEMBER" },
              { org_id: orgBId, user_id: ownerBId, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientOwnerA =
        await signInAnonClient(
          `declarations-isolation-owner-a-${runId}@example.com`,
          password,
        );

      clientMemberA =
        await signInAnonClient(
          `declarations-isolation-member-a-${runId}@example.com`,
          password,
        );

      clientOwnerB =
        await signInAnonClient(
          `declarations-isolation-owner-b-${runId}@example.com`,
          password,
        );

      shipmentOneId =
        await seedShipment(
          `DECL-ISO-ONE-${runId}`,
          [LINE_EMISSIONS[0], LINE_EMISSIONS[1]],
        );

      shipmentTwoId =
        await seedShipment(
          `DECL-ISO-TWO-${runId}`,
          [LINE_EMISSIONS[2]],
        );

      shipmentUncalculatedId =
        await seedShipment(
          `DECL-ISO-UNCALC-${runId}`,
          [],
        );

      declarationMainId =
        await createDeclaration(
          2026,
          [shipmentOneId, shipmentTwoId],
          "READY",
        );

      // A different period, so declarations_period_in_preparation_uq
      // (one DRAFT/READY declaration per org+period) does not collide
      // with the 2026 declaration above.
      declarationDraftId =
        await createDeclaration(
          2025,
          [],
          "DRAFT",
        );

      declarationIncompleteId =
        await createDeclaration(
          2024,
          [shipmentUncalculatedId],
          "READY",
        );
    });

    afterAll(async () => {
      await serviceClient
        .from("declarations")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("calculation_results")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("shipments")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("audit_events")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("organizations")
        .delete()
        .in(
          "id",
          [orgAId, orgBId],
        );

      for (
        const id of [ownerAId, memberAId, ownerBId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "a plain MEMBER of the org cannot INSERT a declaration, and an unrelated org's ADMIN cannot insert one into this org",
      async () => {
        const { error: memberError } =
          await clientMemberA
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2023,
                created_by_user_id: memberAId,
              },
            );

        expect(memberError).not.toBeNull();

        const { error: strangerError } =
          await clientOwnerB
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2022,
                created_by_user_id: ownerBId,
              },
            );

        expect(strangerError).not.toBeNull();
      },
    );

    it(
      "a client cannot INSERT a declaration that already claims to be FILED_RECORDED with a fabricated snapshot and reference",
      async () => {
        // The other half of the FILED_RECORDED gate: banning that status
        // on UPDATE is worthless if a row can simply be born filed.
        const { error } =
          await clientOwnerA
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2021,
                status: "FILED_RECORDED",
                filed_snapshot: { totals: { embedded_emissions_tco2e: "0" } },
                filed_reference: "FORGED-REF-0001",
                filed_at: new Date().toISOString(),
                created_by_user_id: ownerAId,
              },
            );

        expect(error).not.toBeNull();

        const { data: rows } =
          await serviceClient
            .from("declarations")
            .select("id")
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "reporting_period_year",
              2021,
            );

        expect(rows).toEqual(
          [],
        );
      },
    );

    it(
      "a MEMBER can read the org's declarations (screen 21 is MEMBER+); an unrelated org sees none of them",
      async () => {
        const { data: memberSees } =
          await clientMemberA
            .from("declarations")
            .select("id, status")
            .eq(
              "id",
              declarationMainId,
            );

        expect(memberSees).toEqual(
          [
            { id: declarationMainId, status: "READY" },
          ],
        );

        const { data: strangerSees } =
          await clientOwnerB
            .from("declarations")
            .select("id")
            .eq(
              "org_id",
              orgAId,
            );

        expect(strangerSees).toEqual(
          [],
        );
      },
    );

    it(
      "a bare client UPDATE can never set status = FILED_RECORDED, nor write filed_snapshot / filed_reference / filed_at",
      async () => {
        const { error: statusError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { status: "FILED_RECORDED" },
            )
            .eq(
              "id",
              declarationMainId,
            );

        expect(statusError).not.toBeNull();

        const { error: referenceError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { filed_reference: "FORGED-REF-0002" },
            )
            .eq(
              "id",
              declarationMainId,
            );

        expect(referenceError).not.toBeNull();

        const { error: snapshotError } =
          await clientOwnerA
            .from("declarations")
            .update(
              {
                filed_snapshot: {
                  totals: { embedded_emissions_tco2e: "999999" },
                },
              },
            )
            .eq(
              "id",
              declarationMainId,
            );

        expect(snapshotError).not.toBeNull();

        const { error: filedAtError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { filed_at: new Date().toISOString() },
            )
            .eq(
              "id",
              declarationMainId,
            );

        expect(filedAtError).not.toBeNull();

        // "An error came back" is not the assertion that matters -- the
        // row itself must be completely untouched, checked through the
        // service client so no RLS view of it can hide a partial write.
        const { data: untouched } =
          await serviceClient
            .from("declarations")
            .select("status, filed_snapshot, filed_reference, filed_at")
            .eq(
              "id",
              declarationMainId,
            )
            .single();

        expect(untouched).toEqual(
          {
            status: "READY",
            filed_snapshot: null,
            filed_reference: null,
            filed_at: null,
          },
        );
      },
    );

    it(
      "member_shipment_ids and completeness_report are frozen once a declaration leaves DRAFT, and still editable while it is DRAFT",
      async () => {
        const { error: frozenError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { member_shipment_ids: [shipmentUncalculatedId] },
            )
            .eq(
              "id",
              declarationMainId,
            );

        expect(frozenError).not.toBeNull();

        const { error: reportError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { completeness_report: { blockers: ["tampered"] } },
            )
            .eq(
              "id",
              declarationMainId,
            );

        expect(reportError).not.toBeNull();

        const { error: draftError } =
          await clientOwnerA
            .from("declarations")
            .update(
              { member_shipment_ids: [shipmentOneId] },
            )
            .eq(
              "id",
              declarationDraftId,
            );

        expect(draftError).toBeNull();

        const { data: draftRow } =
          await serviceClient
            .from("declarations")
            .select("member_shipment_ids")
            .eq(
              "id",
              declarationDraftId,
            )
            .single();

        expect(draftRow?.member_shipment_ids).toEqual(
          [shipmentOneId],
        );
      },
    );

    it(
      "a plain MEMBER cannot call record_declaration_filed, and nothing moves when they try",
      async () => {
        const { data } =
          await clientMemberA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationMainId,
              p_filed_reference: "MEMBER-SHOULD-NOT-FILE",
            },
          );

        const row =
          (data as RpcResultRow[] | null)?.[0];

        expect(row).toEqual(
          { result_status: "NOT_ADMIN", result_declaration_id: null },
        );

        const { data: declaration } =
          await serviceClient
            .from("declarations")
            .select("status, filed_reference")
            .eq(
              "id",
              declarationMainId,
            )
            .single();

        expect(declaration).toEqual(
          { status: "READY", filed_reference: null },
        );

        const { data: shipments } =
          await serviceClient
            .from("shipments")
            .select("status")
            .in(
              "id",
              [shipmentOneId, shipmentTwoId],
            );

        expect(
          (shipments ?? []).map((s) => s.status).sort(),
        ).toEqual(
          ["READY", "READY"],
        );
      },
    );

    it(
      "an ADMIN of an unrelated org cannot file this org's declaration",
      async () => {
        const { data } =
          await clientOwnerB.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationMainId,
              p_filed_reference: "STRANGER-SHOULD-NOT-FILE",
            },
          );

        const row =
          (data as RpcResultRow[] | null)?.[0];

        expect(row).toEqual(
          { result_status: "NOT_ADMIN", result_declaration_id: null },
        );
      },
    );

    it(
      "record_declaration_filed refuses a DRAFT declaration, a blank filing reference, and a period whose lines carry no calculation result",
      async () => {
        const { data: notReady } =
          await clientOwnerA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationDraftId,
              p_filed_reference: "REF-DRAFT",
            },
          );

        expect(
          (notReady as RpcResultRow[] | null)?.[0]?.result_status,
        ).toBe(
          "NOT_READY",
        );

        // A filing reference is the entire substance of "recording a
        // filing Snowkap did not perform" -- refused, never defaulted or
        // generated (master plan §22).
        const { data: blankReference } =
          await clientOwnerA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationMainId,
              p_filed_reference: "   ",
            },
          );

        expect(
          (blankReference as RpcResultRow[] | null)?.[0]?.result_status,
        ).toBe(
          "EMPTY_FILED_REFERENCE",
        );

        // The freshness gate: a line with no calculation result is
        // refused outright, never summed as zero and never silently
        // dropped from the total.
        const { data: incomplete } =
          await clientOwnerA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationIncompleteId,
              p_filed_reference: "REF-INCOMPLETE",
            },
          );

        expect(
          (incomplete as RpcResultRow[] | null)?.[0]?.result_status,
        ).toBe(
          "INCOMPLETE",
        );

        // A refused filing must leave no wreckage: the shipment it would
        // have locked is still READY.
        const { data: uncalculatedShipment } =
          await serviceClient
            .from("shipments")
            .select("status")
            .eq(
              "id",
              shipmentUncalculatedId,
            )
            .single();

        expect(uncalculatedShipment?.status).toBe(
          "READY",
        );
      },
    );

    it(
      "record_declaration_filed LOCKs every member shipment, freezes a full-precision snapshot, and stores the declarant's reference verbatim",
      async () => {
        // Deliberately padded and mixed-case: filed_reference is what
        // the declarant typed into the official channel, stored exactly
        // as typed. Snowkap never generates, normalizes, or reformats a
        // filing reference (master plan §22).
        const declarantTypedReference =
          "  EU/CBAM/2026/ab-00917  ";

        const { data } =
          await clientOwnerA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationMainId,
              p_filed_reference: declarantTypedReference,
            },
          );

        const row =
          (data as RpcResultRow[] | null)?.[0];

        expect(row).toEqual(
          {
            result_status: "OK",
            result_declaration_id: declarationMainId,
          },
        );

        const { data: declaration } =
          await serviceClient
            .from("declarations")
            .select("status, filed_reference, filed_at, filed_snapshot")
            .eq(
              "id",
              declarationMainId,
            )
            .single();

        expect(declaration?.status).toBe(
          "FILED_RECORDED",
        );

        expect(declaration?.filed_reference).toBe(
          declarantTypedReference,
        );

        expect(declaration?.filed_at).not.toBeNull();

        const snapshot =
          declaration?.filed_snapshot as Record<string, any>;

        // Full precision, unrounded -- see LINE_EMISSIONS' own comment
        // for why this exact total is unreachable by any rounding or
        // float-based implementation.
        expect(snapshot.totals.embedded_emissions_tco2e).toBe(
          EXPECTED_TOTAL_TCO2E,
        );

        expect(snapshot.totals.line_count).toBe(
          3,
        );

        expect(snapshot.totals.shipment_count).toBe(
          2,
        );

        // The honesty callouts are part of the archived record, not just
        // a comment in the migration: a reader of this snapshot years
        // from now must be able to tell that these are full-precision
        // figures and that the declaration-time rounding METHOD is an
        // escalated regulatory gap (RULE-EE-006), and that this is
        // Snowkap's own preparation summary rather than the official
        // registry form.
        expect(snapshot.rounding.applied).toBe(
          false,
        );

        expect(snapshot.rounding.rule_ref).toBe(
          "RULE-EE-006",
        );

        expect(snapshot.rounding.declaration_rounding_method).toBe(
          "UNRESOLVED_ESCALATED",
        );

        expect(snapshot.scope.is_official_form).toBe(
          false,
        );

        expect(snapshot.provenance.engine_versions).toEqual(
          ["1.1.0"],
        );

        expect(snapshot.provenance.determination_methods).toEqual(
          { DEFAULT: 3 },
        );

        expect(snapshot.provenance.regulatory_dataset_versions).toEqual(
          ["2026.1"],
        );

        expect(
          (snapshot.provenance.calculation_result_ids as string[]).length,
        ).toBe(
          3,
        );

        // Every member shipment LOCKed -- the §6 invariant this whole
        // RPC exists to make atomic.
        const { data: memberShipments } =
          await serviceClient
            .from("shipments")
            .select("id, status")
            .in(
              "id",
              [shipmentOneId, shipmentTwoId],
            );

        expect(
          (memberShipments ?? []).map((s) => s.status).sort(),
        ).toEqual(
          ["LOCKED", "LOCKED"],
        );

        // A non-member shipment of the same org is untouched.
        const { data: nonMember } =
          await serviceClient
            .from("shipments")
            .select("status")
            .eq(
              "id",
              shipmentUncalculatedId,
            )
            .single();

        expect(nonMember?.status).toBe(
          "READY",
        );

        // Locking a shipment outside transitionShipmentStatus() must
        // still leave the same audit trail that function does, or the
        // §21 explanation chain silently loses the LOCK.
        const { data: lockEvents } =
          await clientOwnerA
            .from("audit_events")
            .select("aggregate_id, payload")
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "event_type",
              "shipment.locked",
            );

        expect(
          (lockEvents ?? []).map((e) => e.aggregate_id).sort(),
        ).toEqual(
          [shipmentOneId, shipmentTwoId].sort(),
        );

        expect(
          (lockEvents ?? [])[0]?.payload?.locked_by_declaration_id,
        ).toBe(
          declarationMainId,
        );

        const { data: filedEvents } =
          await clientOwnerA
            .from("audit_events")
            .select("aggregate_type, aggregate_id, payload")
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "event_type",
              "declaration.filed",
            );

        expect(filedEvents).toEqual(
          [
            {
              aggregate_type: "DECLARATION",
              aggregate_id: declarationMainId,
              payload: {
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                reporting_period_quarter: null,
                supersedes_declaration_id: null,
                member_shipment_ids:
                  [shipmentOneId, shipmentTwoId].sort(),
                filed_reference: declarantTypedReference,
                line_count: 3,
                embedded_emissions_tco2e: EXPECTED_TOTAL_TCO2E,
                rounding_applied: false,
                rounding_rule_ref: "RULE-EE-006",
              },
            },
          ],
        );
      },
    );

    it(
      "a second record_declaration_filed call is ALREADY_FILED and rewrites nothing -- the ordinary double-click",
      async () => {
        const { data: before } =
          await serviceClient
            .from("declarations")
            .select("filed_reference, filed_at, filed_snapshot")
            .eq(
              "id",
              declarationMainId,
            )
            .single();

        const { data } =
          await clientOwnerA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationMainId,
              p_filed_reference: "SECOND-CLICK-REF",
            },
          );

        expect(
          (data as RpcResultRow[] | null)?.[0],
        ).toEqual(
          { result_status: "ALREADY_FILED", result_declaration_id: null },
        );

        const { data: after } =
          await serviceClient
            .from("declarations")
            .select("filed_reference, filed_at, filed_snapshot")
            .eq(
              "id",
              declarationMainId,
            )
            .single();

        expect(after).toEqual(
          before,
        );
      },
    );

    it(
      "a FILED_RECORDED declaration is out of reach of every bare client UPDATE, including VOID",
      async () => {
        const { data: voidAttempt } =
          await clientOwnerA
            .from("declarations")
            .update(
              { status: "VOID" },
            )
            .eq(
              "id",
              declarationMainId,
            )
            .select("id");

        expect(
          voidAttempt ?? [],
        ).toEqual(
          [],
        );

        const { data: stillFiled } =
          await serviceClient
            .from("declarations")
            .select("status")
            .eq(
              "id",
              declarationMainId,
            )
            .single();

        expect(stillFiled?.status).toBe(
          "FILED_RECORDED",
        );
      },
    );

    it(
      "a second non-VOID original for the same org and ANNUAL period is rejected -- the null-quarter case a bare four-column unique index would let through",
      async () => {
        const { error } =
          await clientOwnerA
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                created_by_user_id: ownerAId,
              },
            );

        expect(error).not.toBeNull();

        expect(error?.code).toBe(
          "23505",
        );

        // An amendment for the same period IS allowed -- it names the
        // version it supersedes, which is exactly what
        // declarations_period_original_uq forces the second declaration
        // for a period to do ("amendments as versions", §6).
        const { data: amendment, error: amendmentError } =
          await clientOwnerA
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                supersedes_declaration_id: declarationMainId,
                created_by_user_id: ownerAId,
              },
            )
            .select("id, status")
            .single();

        expect(amendmentError).toBeNull();

        expect(amendment?.status).toBe(
          "DRAFT",
        );

        // ...but only one live amendment of a given version, so "the
        // current version of this period" always has an answer.
        const { error: branchError } =
          await clientOwnerA
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                supersedes_declaration_id: declarationMainId,
                created_by_user_id: ownerAId,
              },
            );

        expect(branchError).not.toBeNull();

        // ...and an amendment may not point at another org's or another
        // period's declaration (the cross-parent check on
        // declarations_insert_own_org).
        const { error: crossPeriodError } =
          await clientOwnerA
            .from("declarations")
            .insert(
              {
                org_id: orgAId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2023,
                supersedes_declaration_id: declarationMainId,
                created_by_user_id: ownerAId,
              },
            );

        expect(crossPeriodError).not.toBeNull();
      },
    );

    it(
      "a VOID shipment is excluded from the period's member set entirely -- it can never deadlock the period's completeness, and its emissions never reach a period total",
      async () => {
        // A large emissions figure on the shipment about to be VOIDed --
        // if it ever leaked into a total or a member set, this test
        // would see it immediately rather than needing a coincidence.
        const shipmentLiveId =
          await seedShipment(
            `DECL-ISO-VOID-LIVE-${runId}`,
            ["10"],
            2021,
          );

        const shipmentToVoidId =
          await seedShipment(
            `DECL-ISO-VOID-CANCELLED-${runId}`,
            ["999"],
            2021,
          );

        const { error: voidError } =
          await clientOwnerA
            .from("shipments")
            .update(
              { status: "VOID" },
            )
            .eq(
              "id",
              shipmentToVoidId,
            );

        if (voidError) {
          throw new Error(
            `Failed to VOID shipment: ${voidError.message}`,
          );
        }

        // A dedicated period (no declaration created for it anywhere
        // else in this suite), so this is purely "what does the org's
        // 2021 period look like right now" with nothing else contending.
        const period =
          { kind: "ANNUAL", year: 2021 } as never;

        const facts =
          await computeDeclarationDraftFacts(
            clientOwnerA,
            orgAId as never,
            period,
          );

        expect(facts.member_shipment_ids).toEqual(
          [shipmentLiveId],
        );

        expect(facts.completeness_report.complete).toBe(
          true,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [],
        );

        const { shipment_count, lines } =
          await listPeriodShipmentLines(
            clientOwnerA,
            orgAId as never,
            period,
          );

        expect(shipment_count).toBe(
          1,
        );

        expect(lines.map((line) => line.shipment_id)).toEqual(
          [shipmentLiveId],
        );

        const summary =
          await buildPeriodSummary(
            clientOwnerA,
            orgAId as never,
            period,
          );

        // Exactly the live shipment's own "10" -- not "1009"
        // (10 + 999), which is what this assertion would read before
        // the VOID exclusion fix.
        expect(summary.total_embedded_emissions_tco2e).toBe(
          "10",
        );

        expect(summary.shipment_count).toBe(
          1,
        );
      },
    );

    it(
      "record_declaration_filed refuses INCOMPLETE, and locks nothing, when a member shipment is emptied of its only line after the declaration was marked READY",
      async () => {
        const shipmentAId =
          await seedShipment(
            `DECL-ISO-EMPTIED-A-${runId}`,
            ["1"],
            2019,
          );

        const shipmentBId =
          await seedShipment(
            `DECL-ISO-EMPTIED-B-${runId}`,
            ["2"],
            2019,
          );

        const shipmentCId =
          await seedShipment(
            `DECL-ISO-EMPTIED-C-${runId}`,
            ["3"],
            2019,
          );

        const declarationEmptiedId =
          await createDeclaration(
            2020,
            [shipmentAId, shipmentBId, shipmentCId],
            "READY",
          );

        const { data: cLines, error: cLinesError } =
          await serviceClient
            .from("shipment_lines")
            .select("id")
            .eq(
              "shipment_id",
              shipmentCId,
            );

        if (cLinesError || !cLines || cLines.length !== 1) {
          throw new Error(
            `Failed to fetch shipment C's own line: ${cLinesError?.message}`,
          );
        }

        // Deleted as a plain MEMBER, not the ADMIN who marked the
        // declaration READY -- shipment_lines_delete_parent_not_terminal
        // (20260828150000) only excludes LOCKED/VOID parents, and
        // shipment C is still READY, so this is a genuinely permitted
        // action, not a privilege escalation.
        const { error: deleteError } =
          await clientMemberA
            .from("shipment_lines")
            .delete()
            .eq(
              "id",
              cLines[0]?.id,
            );

        if (deleteError) {
          throw new Error(
            `Failed to delete shipment C's own line: ${deleteError.message}`,
          );
        }

        const { data } =
          await clientOwnerA.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declarationEmptiedId,
              p_filed_reference: "REF-EMPTIED-MEMBER",
            },
          );

        const row =
          (data as RpcResultRow[] | null)?.[0];

        expect(row).toEqual(
          { result_status: "INCOMPLETE", result_declaration_id: null },
        );

        // A refused filing must leave no wreckage -- none of the three
        // member shipments were locked, including the two that were
        // themselves still perfectly complete.
        const { data: shipments } =
          await serviceClient
            .from("shipments")
            .select("id, status")
            .in(
              "id",
              [shipmentAId, shipmentBId, shipmentCId],
            );

        expect(
          (shipments ?? []).map((s) => s.status).sort(),
        ).toEqual(
          ["READY", "READY", "READY"],
        );

        const { data: declarationAfter } =
          await serviceClient
            .from("declarations")
            .select("status, filed_snapshot")
            .eq(
              "id",
              declarationEmptiedId,
            )
            .single();

        expect(declarationAfter?.status).toBe(
          "READY",
        );

        expect(declarationAfter?.filed_snapshot).toBeNull();
      },
    );
  },
);
