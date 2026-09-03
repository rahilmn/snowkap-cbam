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

// Adversarial standing suite for the P13 review fix
// (supabase/migrations/20260829470000_p13_review_emission_data_verification_and_evidence_integrity_fix.sql)
// -- three findings, each live-reproduced against real Postgres before
// that migration existed (rolled-back `set local role authenticated` +
// `set local request.jwt.claims` transactions, documented in that
// migration's own header comment) and closed by it:
//
//   1. emission_data.evidence_file_ids could be forged to arbitrary
//      non-existent uuids by a bare client UPDATE, defeating
//      checkEmissionDataEvidenceCompleteness -- and the same bare
//      policy let a plain MEMBER set status='ACTIVE' directly,
//      skipping SUBMIT_FOR_VERIFICATION/VERIFY and the evidence gate
//      entirely.
//   2. verifier_user_id was never pinned to auth.uid() -- an ADMIN
//      could verify a record while naming a completely unrelated
//      person as the verifier.
//   3. verifier_user_id/rejection_reason were silently rewritable on an
//      already-VERIFIED row by a plain MEMBER, as long as the UPDATE
//      never touched verification_status itself.
//
// Same local-only-instance rationale, fixed local demo JWTs (not
// secrets), skip-not-fail discipline, and producer-org/admin+member
// adversarial shape as
// tests/integration/shared-data-consumption-audit.test.ts, which this
// file mirrors rather than duplicates fixture-setup reasoning from.
// This suite exercises the RLS policy + trigger layer directly via raw
// supabase-js client calls (never manage-emission-data.ts /
// upload-evidence.ts) -- it is deliberately testing the DB-layer
// backstop, the wall that stands even when the application layer is
// bypassed entirely.

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

describe.skipIf(!localSupabaseReachable)(
  "emission_data write hardening (P13 review, local Supabase only)",
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

    let producerOrgId: string;

    let producerAdminId: string;
    let producerMemberId: string;
    let outsiderId: string;

    let clientProducerAdmin: SupabaseClient;
    let clientProducerMember: SupabaseClient;

    let operatorId: string;
    let installationId: string;

    // emission_data_version_uq (installation_id, entered_by_org_id,
    // reporting_period_kind, reporting_period_year,
    // coalesce(quarter,0), version) is a real uniqueness constraint --
    // every fixture in this suite shares the same installationId, so
    // each call to insertDraftEmissionData needs its own reporting
    // year to avoid colliding with a previous test's row.
    let nextReportingPeriodYear =
      2100;

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

    async function insertDraftEmissionData(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const reportingPeriodYear =
        nextReportingPeriodYear++;

      const { data, error } =
        await serviceClient
          .from("emission_data")
          .insert(
            {
              installation_id: installationId,
              entered_by_org_id: producerOrgId,
              cn_scope: ["72081000"],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: reportingPeriodYear,
              direct_specific: "1.0",
              indirect_specific: "0.5",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              status: "DRAFT",
              verification_status: "UNVERIFIED",
              version: 1,
              ...overrides,
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to seed emission_data: ${error?.message}`,
        );
      }

      return data.id as string;
    }

    async function insertRealEvidenceFile(
      emissionDataId: string,
      client: SupabaseClient,
      uploadedByUserId: string,
    ): Promise<string> {
      const { data, error } =
        await client
          .from("evidence_files")
          .insert(
            {
              org_id: producerOrgId,
              emission_data_id: emissionDataId,
              storage_path: `${producerOrgId}/${emissionDataId}/${crypto.randomUUID()}.pdf`,
              original_filename: "test.pdf",
              mime_type: "application/pdf",
              size_bytes: 1024,
              sha256: "a".repeat(64),
              uploaded_by_user_id: uploadedByUserId,
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to seed evidence_files row: ${error?.message}`,
        );
      }

      return data.id as string;
    }

    beforeAll(async () => {
      const { data: producerOrg, error: producerOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Emission Data Hardening Producer ${runId}`,
              slug: `emission-data-hardening-producer-${runId}`,
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

      producerOrgId = producerOrg.id;

      const password =
        `emission-data-hardening-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `emission-data-hardening-${label}-${runId}@example.com`,
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

      producerAdminId = await createUser("producer-admin");
      producerMemberId = await createUser("producer-member");
      outsiderId = await createUser("outsider");

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: producerOrgId, user_id: producerAdminId, role: "ADMIN" },
              { org_id: producerOrgId, user_id: producerMemberId, role: "MEMBER" },
              // outsiderId is deliberately NOT a member of producerOrgId at all.
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientProducerAdmin =
        await signInAnonClient(
          `emission-data-hardening-producer-admin-${runId}@example.com`,
          password,
        );

      clientProducerMember =
        await signInAnonClient(
          `emission-data-hardening-producer-member-${runId}@example.com`,
          password,
        );

      const { data: operator, error: operatorError } =
        await clientProducerAdmin
          .from("operators")
          .insert(
            {
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Emission Data Hardening Operator ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (operatorError || !operator) {
        throw new Error(
          `Failed to create operator: ${operatorError?.message}`,
        );
      }

      operatorId = operator.id;

      const { data: installation, error: installationError } =
        await clientProducerAdmin
          .from("installations")
          .insert(
            {
              operator_id: operatorId,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Emission Data Hardening Installation ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (installationError || !installation) {
        throw new Error(
          `Failed to create installation: ${installationError?.message}`,
        );
      }

      installationId = installation.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("evidence_files")
        .delete()
        .eq(
          "org_id",
          producerOrgId,
        );

      await serviceClient
        .from("emission_data")
        .delete()
        .eq(
          "entered_by_org_id",
          producerOrgId,
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
        .from("memberships")
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

      for (
        const id of [
          producerAdminId,
          producerMemberId,
          outsiderId,
        ]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "Finding 1a: a plain MEMBER cannot forge evidence_file_ids to a non-existent uuid via a bare UPDATE",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { evidence_file_ids: [crypto.randomUUID()] },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).not.toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("evidence_file_ids")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.evidence_file_ids).toEqual(
          [],
        );
      },
    );

    it(
      "Finding 1b: a plain MEMBER cannot set status='ACTIVE' directly on a DRAFT+UNVERIFIED+no-evidence row, bypassing the verify workflow",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { status: "ACTIVE" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).not.toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("status")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.status).toBe(
          "DRAFT",
        );
      },
    );

    it(
      "a malformed (non-uuid) evidence_file_ids entry is cleanly rejected by the WITH CHECK anti-join, not a raw Postgres type-cast crash (P13 audit follow-up)",
      async () => {
        // evidence_file_ids is one of app.prevent_emission_data_fact_change's
        // protected "fact" columns -- it can only ever be set at INSERT,
        // never rewritten via UPDATE (not even by service_role: that
        // trigger fires for every role, RLS bypass has no effect on
        // ordinary BEFORE UPDATE triggers), so the malformed value has
        // to be seeded here, at creation.
        const emissionDataId =
          await insertDraftEmissionData(
            { evidence_file_ids: ["not-a-real-uuid"] },
          );

        // A real evidence_files row for this SAME emission_data_id is
        // required to actually exercise the anti-join's uuid cast --
        // with zero evidence_files rows referencing this id at all, the
        // planner resolves the correlated NOT EXISTS as true via the
        // emission_data_id filter alone (empirically confirmed), never
        // evaluating `ef.id = claimed...::uuid` against any row at all,
        // which would make this test pass regardless of whether the
        // cast is hardened.
        await insertRealEvidenceFile(
          emissionDataId,
          serviceClient,
          producerAdminId,
        );

        // updated_at is the one column neither BEFORE UPDATE trigger
        // (app.prevent_emission_data_fact_change,
        // app.enforce_emission_data_verification_gate) constrains at
        // all -- touching any of the "fact" columns those triggers
        // protect (direct_specific, cn_scope, etc.) would raise ITS
        // OWN exception first and never reach the RLS WITH CHECK
        // anti-join this test targets.
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { updated_at: new Date().toISOString() },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).not.toBeNull();

        // A clean policy rejection (Postgres error 42501, "new row
        // violates row-level security policy") is the anti-join
        // correctly treating the malformed entry as "does not name a
        // real evidence_files row" and blocking the UPDATE. Before
        // app.try_cast_uuid() replaced the bare `::uuid` cast here, this
        // same malformed value made the cast itself RAISE
        // invalid_text_representation (22P02) -- a raw internal type
        // error surfacing as the failure instead of a policy rejection,
        // and (per app.try_cast_uuid()'s own precedent from
        // 20260829410000) a shape of bug that, in a USING clause
        // evaluated across a full table scan, can take an entire
        // table's reads offline for every user from a single malformed
        // row -- here confined to this one row's own UPDATE attempts,
        // but still a real, un-recoverable-without-service-role
        // failure mode were it left as a bare cast.
        expect(error?.code).toBe(
          "42501",
        );

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("direct_specific")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.direct_specific).toBe(
          "1.0",
        );
      },
    );

    it(
      "P14/F11: an ACTIVE, VERIFIED record cannot be un-verified -- the move that reopened its evidence for removal",
      async () => {
        /**
         * The evidence-strip round trip, closed.
         *
         * 20260829560000 makes the evidence behind a VERIFIED record
         * immutable, and determine-from-actual-data.ts relies on that
         * when it freezes an evidence set into an importer's snapshot.
         * But the verification gate only ever fired on transitions INTO
         * VERIFIED or REJECTED -- never out of them -- so an ADMIN could
         * walk the record back to VERIFICATION_PENDING, remove a file,
         * and verify it again. verifier_user_id survives untouched, so
         * nothing in the row records that it happened.
         *
         * The party harmed is the OTHER organisation: their frozen
         * determination now cites documents that no longer exist, the
         * v10 validator refuses to re-save that line, and the error it
         * produces explains nothing.
         */
        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
              evidence_file_ids: [crypto.randomUUID()],
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { verification_status: "VERIFICATION_PENDING" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "cannot be un-verified",
        );

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("verification_status")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.verification_status).toBe(
          "VERIFIED",
        );
      },
    );

    it(
      "P14/F11 v2: the downgrade gate is not bypassed by moving status in the same statement",
      async () => {
        /**
         * The hole the first version of this gate had, found by the P14
         * adversarial security re-check and reproduced live before the
         * fix was written.
         *
         * 20260903140000 keyed on `new.status = 'ACTIVE'` as well as
         * `old.status`, so a single UPDATE that moved BOTH columns
         * walked straight past it -- and the whole
         * VERIFIED -> strip evidence -> VERIFIED chain that migration's
         * header named was reproducible again.
         */
        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
              evidence_file_ids: [crypto.randomUUID()],
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              {
                status: "DRAFT",
                verification_status: "VERIFICATION_PENDING",
              },
            )
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "cannot be un-verified",
        );
      },
    );

    it(
      "P14/F11 v2: an ACTIVE record cannot be walked back to DRAFT, which is what defeated the two-statement bypass",
      async () => {
        // The one-statement variant is caught by the un-verify rule
        // above. The TWO-statement variant is not: park the record at
        // DRAFT first and every gate keyed on old.status = 'ACTIVE'
        // stops applying to it. There is no ACTIVE -> DRAFT transition
        // in the domain at all, so forbidding it costs nothing.
        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { status: "DRAFT" },
            )
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "cannot return to DRAFT",
        );
      },
    );

    it(
      "P14/F11 v2: evidence cannot be REMOVED from an ACTIVE, VERIFIED record -- no downgrade required to reach this",
      async () => {
        /**
         * Worse and simpler than the downgrade chain, and missed
         * entirely by the first version of this gate.
         *
         * 20260829560000 made the evidence_files ROWS immutable behind a
         * VERIFIED record, and removeEvidenceFile refuses in the
         * application. Neither touches emission_data's own
         * evidence_file_ids ARRAY, and the fact-immutability trigger
         * deliberately omits it so files can still be ADDED. So the
         * array could simply be emptied, in one statement, leaving the
         * record ACTIVE + VERIFIED with no evidence at all.
         *
         * The importer is the one harmed: the v10 validator compares
         * their frozen evidence set byte-for-byte against this array.
         */
        const evidenceId =
          crypto.randomUUID();

        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
              evidence_file_ids: [evidenceId],
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { evidence_file_ids: [] },
            )
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "evidence cannot be removed",
        );

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("evidence_file_ids")
            .eq("id", emissionDataId)
            .single();

        expect(
          (after as { evidence_file_ids: string[] }).evidence_file_ids,
        ).toEqual(
          [evidenceId],
        );
      },
    );

    it(
      "P14/F11 v2: the new guard does not block ADDING evidence to an ACTIVE, VERIFIED record",
      async () => {
        /**
         * The direction that must stay open. actual-determination-is-
         * unchanged.ts reasons explicitly that a grown evidence set is
         * why a redetermination has to be allowed to proceed -- a guard
         * that blocked additions would freeze importers out of the only
         * repair available to them.
         *
         * Exercised through the SERVICE ROLE deliberately. RLS bypasses
         * for it; triggers do not. So this isolates the question this
         * test is actually about -- does the new trigger refuse an
         * addition? -- from a separate, correct wall that would
         * otherwise mask the answer:
         * emission_data_update_own_org's WITH CHECK independently
         * requires every id in evidence_file_ids to reference a real
         * evidence_files row for this record, so an ordinary caller
         * cannot invent one. That policy is what makes ADDITION safe;
         * the trigger is what makes REMOVAL impossible. Emptying the
         * array satisfied that policy vacuously, which is exactly the
         * hole the trigger closes.
         */
        const original =
          crypto.randomUUID();

        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
              evidence_file_ids: [original],
            },
          );

        const { error } =
          await serviceClient
            .from("emission_data")
            .update(
              { evidence_file_ids: [original, crypto.randomUUID()] },
            )
            .eq("id", emissionDataId);

        expect(error).toBeNull();
      },
    );

    it(
      "P14/F11 v2: an ordinary caller still cannot invent an evidence id that references no file",
      async () => {
        // The other half of the pair above, and the reason additions can
        // be left open at all.
        const original =
          crypto.randomUUID();

        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
              evidence_file_ids: [original],
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { evidence_file_ids: [original, crypto.randomUUID()] },
            )
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();
      },
    );

    it(
      "P14/F11 v2: swapping one evidence id for another is caught, even though the count is unchanged",
      async () => {
        // Set containment, not length. A same-count swap replaces the
        // very documents a frozen determination cites.
        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
              evidence_file_ids: [crypto.randomUUID()],
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { evidence_file_ids: [crypto.randomUUID()] },
            )
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "evidence cannot be removed",
        );
      },
    );

    it(
      "P14/F11: the gate is narrow -- a DRAFT record's verification can still move freely",
      async () => {
        // A gate that never opens is indistinguishable from a broken
        // one. Only an ACTIVE record is protected: a DRAFT record is
        // nobody else's dependency yet, and the ordinary submit /
        // verify / reject / resubmit loop must keep working.
        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "DRAFT",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { verification_status: "VERIFICATION_PENDING" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).toBeNull();
      },
    );

    it(
      "P14/F11: discarding an ACTIVE, VERIFIED record still works -- the legitimate way out is untouched",
      async () => {
        // The gate must not trap a record forever. DISCARD and being
        // SUPERSEDED both change `status`, not `verification_status`,
        // and both remain available.
        const emissionDataId =
          await insertDraftEmissionData(
            {
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerAdminId,
            },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              { status: "DISCARDED" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).toBeNull();
      },
    );

    it(
      "Finding 2: an ADMIN verifying a record cannot name an arbitrary other user as verifier_user_id -- it is force-pinned to their own auth.uid()",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData(
            { verification_status: "VERIFICATION_PENDING" },
          );

        const { error } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              {
                verification_status: "VERIFIED",
                // Attempting to name a non-member outsider as the
                // verifier -- this must be silently overwritten, not
                // merely rejected.
                verifier_user_id: outsiderId,
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("verification_status, verifier_user_id")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.verification_status).toBe(
          "VERIFIED",
        );

        expect(after?.verifier_user_id).toBe(
          producerAdminId,
        );

        expect(after?.verifier_user_id).not.toBe(
          outsiderId,
        );
      },
    );

    it(
      "Finding 3: a plain MEMBER cannot rewrite verifier_user_id or rejection_reason on an already-VERIFIED row without touching verification_status",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData(
            { verification_status: "VERIFICATION_PENDING" },
          );

        const { error: verifyError } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              {
                verification_status: "VERIFIED",
                verifier_user_id: producerAdminId,
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(verifyError).toBeNull();

        const { error: forgeVerifierError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { verifier_user_id: producerMemberId },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(forgeVerifierError).not.toBeNull();

        const { error: forgeReasonError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { rejection_reason: "forged after verification" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(forgeReasonError).not.toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("verification_status, verifier_user_id, rejection_reason")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.verification_status).toBe(
          "VERIFIED",
        );

        expect(after?.verifier_user_id).toBe(
          producerAdminId,
        );

        expect(after?.rejection_reason).toBeNull();
      },
    );

    it(
      "a plain MEMBER (non-admin) still cannot VERIFY a record directly -- the pre-existing ADMIN+ gate is unchanged",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData(
            { verification_status: "VERIFICATION_PENDING" },
          );

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update(
              {
                verification_status: "VERIFIED",
                verifier_user_id: producerMemberId,
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "legitimate flow: SUBMIT_FOR_VERIFICATION -> VERIFY -> real evidence upload -> ACTIVATE all still succeed for a plain MEMBER/ADMIN pair",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData();

        const { error: submitError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              {
                verification_status: "VERIFICATION_PENDING",
                rejection_reason: null,
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(submitError).toBeNull();

        const { error: verifyError } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              {
                verification_status: "VERIFIED",
                verifier_user_id: producerAdminId,
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(verifyError).toBeNull();

        // Real evidence, uploaded the same way
        // src/application/evidence/upload-evidence.ts's uploadEvidenceFile
        // does: insert the metadata row via the caller's own
        // RLS-enforced client, then append its id onto
        // emission_data.evidence_file_ids.
        const evidenceFileId =
          await insertRealEvidenceFile(
            emissionDataId,
            clientProducerMember,
            producerMemberId,
          );

        const { error: linkError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { evidence_file_ids: [evidenceFileId] },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(linkError).toBeNull();

        const { error: activateError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { status: "ACTIVE" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(activateError).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("status, verification_status, evidence_file_ids, verifier_user_id")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.status).toBe(
          "ACTIVE",
        );

        expect(after?.verification_status).toBe(
          "VERIFIED",
        );

        expect(after?.evidence_file_ids).toEqual(
          [evidenceFileId],
        );

        expect(after?.verifier_user_id).toBe(
          producerAdminId,
        );
      },
    );

    it(
      "legitimate flow: REJECT (ADMIN) then SUBMIT_FOR_VERIFICATION resubmission (MEMBER) clears rejection_reason in the same UPDATE that changes verification_status",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData(
            { verification_status: "VERIFICATION_PENDING" },
          );

        const { error: rejectError } =
          await clientProducerAdmin
            .from("emission_data")
            .update(
              {
                verification_status: "REJECTED",
                rejection_reason: "insufficient supporting evidence",
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(rejectError).toBeNull();

        const { error: resubmitError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              {
                verification_status: "VERIFICATION_PENDING",
                rejection_reason: null,
              },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(resubmitError).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("verification_status, rejection_reason")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.verification_status).toBe(
          "VERIFICATION_PENDING",
        );

        expect(after?.rejection_reason).toBeNull();
      },
    );

    it(
      "legitimate flow: DISCARD still succeeds for a plain MEMBER on a fresh DRAFT row regardless of verification_status",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { status: "DISCARDED" },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(error).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("status")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.status).toBe(
          "DISCARDED",
        );
      },
    );

    it(
      "legitimate flow: removing evidence (real evidence_files delete + unlink) still succeeds for a plain MEMBER",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData();

        const evidenceFileId =
          await insertRealEvidenceFile(
            emissionDataId,
            clientProducerMember,
            producerMemberId,
          );

        const { error: linkError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { evidence_file_ids: [evidenceFileId] },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(linkError).toBeNull();

        const { error: deleteError } =
          await clientProducerMember
            .from("evidence_files")
            .delete()
            .eq(
              "id",
              evidenceFileId,
            );

        expect(deleteError).toBeNull();

        const { error: unlinkError } =
          await clientProducerMember
            .from("emission_data")
            .update(
              { evidence_file_ids: [] },
            )
            .eq(
              "id",
              emissionDataId,
            );

        expect(unlinkError).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("evidence_file_ids")
            .eq(
              "id",
              emissionDataId,
            )
            .single();

        expect(after?.evidence_file_ids).toEqual(
          [],
        );
      },
    );

    it(
      "rejects deleting an evidence file whose owning emission_data record is VERIFIED (P13 review, finding S6) -- live-reproduced before this policy existed: a plain MEMBER could delete evidence backing an already-VERIFIED (or ACTIVE/SUPERSEDED, both necessarily VERIFIED too) record with nothing at any layer stopping them",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData(
            { verification_status: "VERIFIED", verifier_user_id: producerAdminId },
          );

        const evidenceFileId =
          await insertRealEvidenceFile(
            emissionDataId,
            clientProducerMember,
            producerMemberId,
          );

        const { error: deleteError, data: deleteData } =
          await clientProducerMember
            .from("evidence_files")
            .delete()
            .eq(
              "id",
              evidenceFileId,
            )
            .select("id");

        expect(deleteError).toBeNull();
        expect(deleteData).toHaveLength(
          0,
        );

        const { data: stillThere } =
          await serviceClient
            .from("evidence_files")
            .select("id")
            .eq(
              "id",
              evidenceFileId,
            )
            .maybeSingle();

        expect(stillThere?.id).toBe(
          evidenceFileId,
        );
      },
    );

    it(
      "allows deleting an evidence file whose owning emission_data record is DRAFT + REJECTED -- a producer fixing evidence before resubmitting must not be blocked",
      async () => {
        const emissionDataId =
          await insertDraftEmissionData(
            { verification_status: "REJECTED", rejection_reason: "insufficient documentation" },
          );

        const evidenceFileId =
          await insertRealEvidenceFile(
            emissionDataId,
            clientProducerMember,
            producerMemberId,
          );

        const { error: deleteError, data: deleteData } =
          await clientProducerMember
            .from("evidence_files")
            .delete()
            .eq(
              "id",
              evidenceFileId,
            )
            .select("id");

        expect(deleteError).toBeNull();
        expect(deleteData).toHaveLength(
          1,
        );
      },
    );
  },
);
