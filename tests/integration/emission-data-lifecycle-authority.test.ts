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

// Standing adversarial suite for P14 blockers B1 and B2, both
// live-reproduced against real Postgres as a plain MEMBER before the
// migrations below existed, inside rolled-back transactions with
// post-rollback leakage verified 0.
//
//   B1  supabase/migrations/20260903200000_p14_emission_data_insert_trusted_lifecycle_state.sql
//       emission_data had NO INSERT-time gate. All four triggers on the
//       table were BEFORE UPDATE, so every invariant -- ADMIN+-only
//       verification, verifier_user_id forced to auth.uid(), DRAFT ->
//       ACTIVE requiring evidence, evidence ids having to resolve --
//       was an OLD-vs-NEW comparison an INSERT never reached. One
//       statement produced a record that was already ACTIVE and
//       VERIFIED, with a forged verifier and an evidence id naming no
//       evidence_files row. Because shared-row visibility keys on
//       exactly ACTIVE + VERIFIED, a grantee importer then read it as
//       operator-attested verified data.
//
//   B2  supabase/migrations/20260903210000_p14_emission_data_verified_lineage_lock.sql
//       Every evidence and un-verify rule was keyed on
//       `old.status = 'ACTIVE'`, so parking the row in a terminal state
//       first made all of them stop applying:
//       ACTIVE -> DISCARDED -> DRAFT -> un-verify -> strip evidence.
//       Fixed with a durable marker (verified_active_at) plus the
//       status state machine the schema never had.
//
// Same shape as tests/integration/emission-data-write-hardening.test.ts,
// which this file sits beside rather than duplicates reasoning from:
// local-only, fixed local demo JWTs (not secrets), skip-not-fail, and
// raw supabase-js against the RLS/trigger layer -- never through
// manage-emission-data.ts. The point is the wall that stands when the
// application layer is bypassed entirely, because that is exactly what
// both blockers did.

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
        { signal: AbortSignal.timeout(1500) },
      );

    return response.ok;
  } catch {
    return false;
  }
}

const localSupabaseReachable =
  await isLocalSupabaseReachable();

describe.skipIf(!localSupabaseReachable)(
  "emission_data lifecycle authority (P14 blockers B1 + B2, local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(0, 8);

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    let producerOrgId: string;
    let importerOrgId: string;

    let producerAdminId: string;
    let producerMemberId: string;
    let importerMemberId: string;

    let clientProducerAdmin: SupabaseClient;
    let clientProducerMember: SupabaseClient;
    let clientImporterMember: SupabaseClient;

    let installationId: string;

    // emission_data_version_uq makes (installation, period, version)
    // unique, and every fixture here shares one installation -- so each
    // record needs its own reporting year.
    let nextReportingPeriodYear = 2300;

    const password = `emission-data-authority-${runId}!`;

    async function signInAnonClient(email: string): Promise<SupabaseClient> {
      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error } =
        await client.auth.signInWithPassword({ email, password });

      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }

      return client;
    }

    /**
     * Create a record the ONLY way the product can: a member creates a
     * DRAFT, evidence is attached, an ADMIN verifies, an ADMIN
     * activates. Returns the id of an ACTIVE + VERIFIED record with one
     * real evidence file behind it.
     */
    async function createGenuinelyActiveVerifiedRecord(): Promise<{
      emissionDataId: string;
      evidenceFileId: string;
      reportingPeriodYear: number;
    }> {
      const reportingPeriodYear = nextReportingPeriodYear++;

      const { data: created, error: createError } =
        await clientProducerMember
          .from("emission_data")
          .insert({
            installation_id: installationId,
            entered_by_org_id: producerOrgId,
            cn_scope: ["72081000"],
            reporting_period_kind: "ANNUAL",
            reporting_period_year: reportingPeriodYear,
            direct_specific: "3.100",
            indirect_specific: "0.500",
            emission_unit: "tCO2e/t",
            methodology: "EU_METHOD",
          })
          .select("id")
          .single();

      if (createError || !created) {
        throw new Error(`legitimate DRAFT create failed: ${createError?.message}`);
      }

      const emissionDataId = created.id as string;

      const { data: evidence, error: evidenceError } =
        await clientProducerMember
          .from("evidence_files")
          .insert({
            org_id: producerOrgId,
            emission_data_id: emissionDataId,
            storage_path: `${producerOrgId}/${emissionDataId}/${crypto.randomUUID()}.pdf`,
            original_filename: "verifier-report.pdf",
            mime_type: "application/pdf",
            size_bytes: 1024,
            sha256: "a".repeat(64),
            uploaded_by_user_id: producerMemberId,
          })
          .select("id")
          .single();

      if (evidenceError || !evidence) {
        throw new Error(`evidence seed failed: ${evidenceError?.message}`);
      }

      const evidenceFileId = evidence.id as string;

      const attach =
        await clientProducerMember
          .from("emission_data")
          .update({ evidence_file_ids: [evidenceFileId] })
          .eq("id", emissionDataId);

      if (attach.error) {
        throw new Error(`evidence attach failed: ${attach.error.message}`);
      }

      const submit =
        await clientProducerMember
          .from("emission_data")
          .update({ verification_status: "VERIFICATION_PENDING" })
          .eq("id", emissionDataId);

      if (submit.error) {
        throw new Error(`submit failed: ${submit.error.message}`);
      }

      const verify =
        await clientProducerAdmin
          .from("emission_data")
          .update({
            verification_status: "VERIFIED",
            verifier_user_id: producerAdminId,
          })
          .eq("id", emissionDataId);

      if (verify.error) {
        throw new Error(`verify failed: ${verify.error.message}`);
      }

      const activate =
        await clientProducerAdmin
          .from("emission_data")
          .update({ status: "ACTIVE" })
          .eq("id", emissionDataId);

      if (activate.error) {
        throw new Error(`activate failed: ${activate.error.message}`);
      }

      return { emissionDataId, evidenceFileId, reportingPeriodYear };
    }

    async function readRecord(emissionDataId: string): Promise<{
      status: string;
      verification_status: string;
      verifier_user_id: string | null;
      evidence_file_ids: string[];
      verified_active_at: string | null;
    }> {
      const { data, error } =
        await serviceClient
          .from("emission_data")
          .select(
            "status, verification_status, verifier_user_id, evidence_file_ids, verified_active_at",
          )
          .eq("id", emissionDataId)
          .single();

      if (error || !data) {
        throw new Error(`read back failed: ${error?.message}`);
      }

      return data as never;
    }

    beforeAll(async () => {
      async function createOrg(
        label: string,
        capabilities: string[],
      ): Promise<string> {
        const { data, error } =
          await serviceClient
            .from("organizations")
            .insert({
              name: `Emission Data Authority ${label} ${runId}`,
              slug: `emission-data-authority-${label}-${runId}`,
              capabilities,
            })
            .select("id")
            .single();

        if (error || !data) {
          throw new Error(`Failed to create ${label} org: ${error?.message}`);
        }

        return data.id as string;
      }

      producerOrgId = await createOrg("producer", ["PRODUCER_OPERATOR"]);
      importerOrgId = await createOrg("importer", ["IMPORTER_DECLARANT"]);

      async function createUser(label: string): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser({
            email: `emission-data-authority-${label}-${runId}@example.com`,
            password,
            email_confirm: true,
          });

        if (error || !data.user) {
          throw new Error(`Failed to create ${label}: ${error?.message}`);
        }

        return data.user.id;
      }

      producerAdminId = await createUser("producer-admin");
      producerMemberId = await createUser("producer-member");
      importerMemberId = await createUser("importer-member");

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert([
            { org_id: producerOrgId, user_id: producerAdminId, role: "ADMIN" },
            { org_id: producerOrgId, user_id: producerMemberId, role: "MEMBER" },
            { org_id: importerOrgId, user_id: importerMemberId, role: "MEMBER" },
          ]);

      if (membershipError) {
        throw new Error(`Failed to create memberships: ${membershipError.message}`);
      }

      clientProducerAdmin = await signInAnonClient(
        `emission-data-authority-producer-admin-${runId}@example.com`,
      );
      clientProducerMember = await signInAnonClient(
        `emission-data-authority-producer-member-${runId}@example.com`,
      );
      clientImporterMember = await signInAnonClient(
        `emission-data-authority-importer-member-${runId}@example.com`,
      );

      const { data: operator, error: operatorError } =
        await clientProducerAdmin
          .from("operators")
          .insert({
            org_id: producerOrgId,
            provenance: "OPERATOR_PROVIDED",
            name: `Emission Data Authority Operator ${runId}`,
            country: "IN",
          })
          .select("id")
          .single();

      if (operatorError || !operator) {
        throw new Error(`Failed to create operator: ${operatorError?.message}`);
      }

      const { data: installation, error: installationError } =
        await clientProducerAdmin
          .from("installations")
          .insert({
            operator_id: operator.id,
            org_id: producerOrgId,
            provenance: "OPERATOR_PROVIDED",
            name: `Emission Data Authority Installation ${runId}`,
            country: "IN",
          })
          .select("id")
          .single();

      if (installationError || !installation) {
        throw new Error(
          `Failed to create installation: ${installationError?.message}`,
        );
      }

      installationId = installation.id as string;

      // An ACTIVE sharing grant, so the cross-tenant visibility
      // assertions below are about what a real grantee importer sees.
      const { data: grant, error: grantError } =
        await serviceClient
          .from("sharing_grants")
          .insert({
            grantor_org_id: producerOrgId,
            grantee_org_id: importerOrgId,
            installation_id: installationId,
            status: "ACTIVE",
            created_by_user_id: producerAdminId,
          })
          .select("id")
          .single();

      if (grantError || !grant) {
        throw new Error(`Failed to issue sharing grant: ${grantError?.message}`);
      }
    });

    afterAll(async () => {
      await serviceClient.from("evidence_files").delete().eq("org_id", producerOrgId);
      await serviceClient.from("sharing_grants").delete().eq("grantor_org_id", producerOrgId);
      await serviceClient.from("emission_data").delete().eq("entered_by_org_id", producerOrgId);
      await serviceClient.from("installations").delete().eq("org_id", producerOrgId);
      await serviceClient.from("operators").delete().eq("org_id", producerOrgId);
      await serviceClient.from("audit_events").delete().eq("org_id", producerOrgId);
      await serviceClient.from("audit_events").delete().eq("org_id", importerOrgId);
      await serviceClient.from("memberships").delete().eq("org_id", producerOrgId);
      await serviceClient.from("memberships").delete().eq("org_id", importerOrgId);
      await serviceClient.from("organizations").delete().eq("id", producerOrgId);
      await serviceClient.from("organizations").delete().eq("id", importerOrgId);

      for (const userId of [producerAdminId, producerMemberId, importerMemberId]) {
        if (userId) {
          await serviceClient.auth.admin.deleteUser(userId);
        }
      }
    });

    /**
     * Every INSERT below is the same shape the product sends, plus the
     * one forged field under test -- so a failure here is unambiguously
     * about that field.
     */
    function forgedInsert(
      overrides: Record<string, unknown>,
    ): Record<string, unknown> {
      return {
        installation_id: installationId,
        entered_by_org_id: producerOrgId,
        cn_scope: ["72081000"],
        reporting_period_kind: "ANNUAL",
        reporting_period_year: nextReportingPeriodYear++,
        direct_specific: "0.000001",
        indirect_specific: "0",
        emission_unit: "tCO2e/t",
        methodology: "EU_METHOD",
        ...overrides,
      };
    }

    describe("B1 -- authority cannot be asserted at creation", () => {
      it("B1.1 refuses a MEMBER INSERT of ACTIVE + VERIFIED with a self-named verifier and a phantom evidence id", async () => {
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .insert(
              forgedInsert({
                status: "ACTIVE",
                verification_status: "VERIFIED",
                verifier_user_id: producerMemberId,
                evidence_file_ids: [crypto.randomUUID()],
              }),
            );

        expect(error).not.toBeNull();
        expect(error?.message).toContain("always created as DRAFT");
      });

      it("B1.2 refuses a MEMBER INSERT of VERIFIED even with status left DRAFT", async () => {
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .insert(
              forgedInsert({
                verification_status: "VERIFIED",
                verifier_user_id: producerMemberId,
              }),
            );

        expect(error).not.toBeNull();
        expect(error?.message).toContain("always created UNVERIFIED");
      });

      it("B1.3 refuses a MEMBER naming THEMSELVES as verifier at creation", async () => {
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .insert(forgedInsert({ verifier_user_id: producerMemberId }));

        expect(error).not.toBeNull();
        expect(error?.message).toContain("verifier_user_id cannot be set at creation");
      });

      it(
        "B1.4 refuses a MEMBER naming ANOTHER user -- a real ADMIN of the org -- " +
          "as verifier at creation. Found by the P14 remediation probe and worse " +
          "than the reported case: the forged row was attributed to an " +
          "administrator who never saw it",
        async () => {
          const { error } =
            await clientProducerMember
              .from("emission_data")
              .insert(forgedInsert({ verifier_user_id: producerAdminId }));

          expect(error).not.toBeNull();
          expect(error?.message).toContain("verifier_user_id cannot be set at creation");
        },
      );

      it("B1.5 refuses fabricated evidence ids at creation", async () => {
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .insert(
              forgedInsert({ evidence_file_ids: [crypto.randomUUID()] }),
            );

        expect(error).not.toBeNull();
        expect(error?.message).toContain("evidence cannot be attached at creation");
      });

      it("B1.6 refuses ACTIVE at creation even when unverified", async () => {
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .insert(forgedInsert({ status: "ACTIVE" }));

        expect(error).not.toBeNull();
        expect(error?.message).toContain("always created as DRAFT");
      });

      it("B1.7 refuses a preset rejection_reason at creation", async () => {
        const { error } =
          await clientProducerMember
            .from("emission_data")
            .insert(forgedInsert({ rejection_reason: "preset" }));

        expect(error).not.toBeNull();
        expect(error?.message).toContain("rejection_reason cannot be set at creation");
      });

      it(
        "B1.8 still refuses a cross-org entered_by_org_id -- RLS, unchanged, " +
          "asserted here so the new gate cannot be read as having replaced it",
        async () => {
          const { error } =
            await clientProducerMember
              .from("emission_data")
              .insert(forgedInsert({ entered_by_org_id: importerOrgId }));

          expect(error).not.toBeNull();
          expect(error?.message).toContain("row-level security");
        },
      );

      it("B1.9 the legitimate verification and activation path still works end to end", async () => {
        const { emissionDataId, evidenceFileId } =
          await createGenuinelyActiveVerifiedRecord();

        const record = await readRecord(emissionDataId);

        expect(record.status).toBe("ACTIVE");
        expect(record.verification_status).toBe("VERIFIED");
        // The verifier is the ADMIN who actually verified, written from
        // auth.uid() by the verification gate -- not a client claim.
        expect(record.verifier_user_id).toBe(producerAdminId);
        expect(record.evidence_file_ids).toEqual([evidenceFileId]);
        expect(record.verified_active_at).not.toBeNull();
      });

      it(
        "B1.10 a MEMBER cannot make a record visible to a grantee importer " +
          "without walking the lifecycle -- the cross-tenant claim the whole " +
          "sharing model rests on",
        async () => {
          const forged =
            await clientProducerMember
              .from("emission_data")
              .insert(
                forgedInsert({
                  status: "ACTIVE",
                  verification_status: "VERIFIED",
                  verifier_user_id: producerAdminId,
                  evidence_file_ids: [crypto.randomUUID()],
                }),
              );

          expect(forged.error).not.toBeNull();

          // And nothing forged reached the importer's view.
          const { data: sharedRows, error: sharedError } =
            await clientImporterMember
              .from("emission_data")
              .select("id, direct_specific")
              .eq("installation_id", installationId);

          expect(sharedError).toBeNull();
          expect(
            (sharedRows ?? []).some(
              (row) => (row as { direct_specific: string }).direct_specific === "0.000001",
            ),
          ).toBe(false);
        },
      );

      it(
        "B1.11 a legitimately activated record IS visible to the grantee importer -- " +
          "proving the gate closed the forgery without closing the product",
        async () => {
          const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

          const { data, error } =
            await clientImporterMember
              .from("emission_data")
              .select("id, status, verification_status")
              .eq("id", emissionDataId)
              .maybeSingle();

          expect(error).toBeNull();
          expect(data).not.toBeNull();
          expect(data).toMatchObject({
            status: "ACTIVE",
            verification_status: "VERIFIED",
          });
        },
      );
    });

    describe("verifier independence (P14 owner decision 6)", () => {
      it(
        "refuses a VERIFY by the user who created the record -- one person " +
          "cannot be both the author and the attestor of a figure a " +
          "counterparty will rely on",
        async () => {
          // The ADMIN creates it themselves this time, rather than the
          // MEMBER, so the creator and the only permitted verifier are
          // the same person.
          const { data: created, error: createError } =
            await clientProducerAdmin
              .from("emission_data")
              .insert(forgedInsert({}))
              .select("id, created_by_user_id")
              .single();

          expect(createError).toBeNull();
          // Written by the database from auth.uid(), never accepted from
          // the caller -- the rule below turns on this being true.
          expect(created?.created_by_user_id).toBe(producerAdminId);

          const submit =
            await clientProducerAdmin
              .from("emission_data")
              .update({ verification_status: "VERIFICATION_PENDING" })
              .eq("id", created!.id);

          expect(submit.error).toBeNull();

          const { error } =
            await clientProducerAdmin
              .from("emission_data")
              .update({
                verification_status: "VERIFIED",
                verifier_user_id: producerAdminId,
              })
              .eq("id", created!.id);

          expect(error).not.toBeNull();
          expect(error?.message).toContain("cannot also verify it");
        },
      );

      it(
        "allows a VERIFY by a different ADMIN -- this is a two-person rule, " +
          "not an organisational one, and the ordinary workflow is untouched",
        async () => {
          const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

          const record = await readRecord(emissionDataId);

          // Created by the MEMBER, verified by the ADMIN.
          expect(record.verification_status).toBe("VERIFIED");
          expect(record.verifier_user_id).toBe(producerAdminId);
        },
      );
    });

    describe("B2 -- a verified record's evidentiary basis is permanent", () => {
      it("B2.1 direct bypass: evidence cannot be emptied on an ACTIVE + VERIFIED record", async () => {
        const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update({ evidence_file_ids: [] })
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();
        expect(error?.message).toContain("evidence cannot be removed");
      });

      it("B2.2 one-statement bypass: ACTIVE + VERIFIED -> DRAFT + PENDING in a single UPDATE", async () => {
        const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update({
              status: "DRAFT",
              verification_status: "VERIFICATION_PENDING",
            })
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();
      });

      it("B2.3 two-statement bypass: ACTIVE -> DRAFT, then un-verify", async () => {
        const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update({ status: "DRAFT" })
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();
        expect(error?.message).toContain("not a lifecycle transition");
      });

      it(
        "B2.4 FOUR-STEP bypass, the one that defeated the previous fix: " +
          "ACTIVE -> DISCARDED -> DRAFT -> un-verify -> strip evidence",
        async () => {
          const { emissionDataId, evidenceFileId } =
            await createGenuinelyActiveVerifiedRecord();

          // Step 1 SUCCEEDS, and must: 20260903140000 deliberately kept
          // discard open as the legitimate way out of a verified, active
          // record, and two other suites assert that. An earlier draft
          // of the fix forbade it and broke both -- recorded here so
          // nobody "hardens" it again.
          const step1 =
            await clientProducerMember
              .from("emission_data")
              .update({ status: "DISCARDED" })
              .eq("id", emissionDataId);

          expect(step1.error).toBeNull();

          // Step 2 is the wall. Without it, the record is parked
          // somewhere every gate keyed on old.status = 'ACTIVE' has
          // stopped applying.
          const step2 =
            await clientProducerMember
              .from("emission_data")
              .update({ status: "DRAFT" })
              .eq("id", emissionDataId);

          expect(step2.error).not.toBeNull();
          expect(step2.error?.message).toContain("not a lifecycle transition");

          // And the steps the chain needed next are refused on their own
          // merits, in the terminal state, by the durable marker -- so
          // the chain would die here even if step 2 were ever widened.
          const step3 =
            await clientProducerMember
              .from("emission_data")
              .update({ verification_status: "VERIFICATION_PENDING" })
              .eq("id", emissionDataId);

          expect(step3.error).not.toBeNull();
          expect(step3.error?.message).toContain("verification is permanent");

          const step4 =
            await clientProducerMember
              .from("emission_data")
              .update({ evidence_file_ids: [] })
              .eq("id", emissionDataId);

          expect(step4.error).not.toBeNull();
          expect(step4.error?.message).toContain("evidence cannot be removed");

          const record = await readRecord(emissionDataId);

          expect(record.status).toBe("DISCARDED");
          expect(record.verification_status).toBe("VERIFIED");
          expect(record.evidence_file_ids).toEqual([evidenceFileId]);
        },
      );

      it("B2.5 alternate terminal state: ACTIVE -> SUPERSEDED -> DRAFT", async () => {
        const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

        // ACTIVE -> SUPERSEDED is legitimate (it is how a new version
        // retires the old one), so this one must succeed...
        const retire =
          await clientProducerMember
            .from("emission_data")
            .update({ status: "SUPERSEDED" })
            .eq("id", emissionDataId);

        expect(retire.error).toBeNull();

        // ...and the way back out must not.
        const resurrect =
          await clientProducerMember
            .from("emission_data")
            .update({ status: "DRAFT" })
            .eq("id", emissionDataId);

        expect(resurrect.error).not.toBeNull();
        expect(resurrect.error?.message).toContain("not a lifecycle transition");
      });

      it(
        "B2.6 evidence deletion after a downgrade: un-verifying is refused in " +
          "EVERY state once the record has been ACTIVE and VERIFIED, not just " +
          "while it is still ACTIVE",
        async () => {
          const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

          const retire =
            await clientProducerMember
              .from("emission_data")
              .update({ status: "SUPERSEDED" })
              .eq("id", emissionDataId);

          expect(retire.error).toBeNull();

          const unverify =
            await clientProducerMember
              .from("emission_data")
              .update({ verification_status: "VERIFICATION_PENDING" })
              .eq("id", emissionDataId);

          expect(unverify.error).not.toBeNull();
          expect(unverify.error?.message).toContain("verification is permanent");
        },
      );

      it(
        "B2.7 replacement evidence: substituting one real file for another, same " +
          "count, is refused -- the more dangerous case, because the record " +
          "still looks complete",
        async () => {
          const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

          const { data: substitute, error: substituteError } =
            await clientProducerMember
              .from("evidence_files")
              .insert({
                org_id: producerOrgId,
                emission_data_id: emissionDataId,
                storage_path: `${producerOrgId}/${emissionDataId}/${crypto.randomUUID()}.pdf`,
                original_filename: "substitute.pdf",
                mime_type: "application/pdf",
                size_bytes: 2048,
                sha256: "c".repeat(64),
                uploaded_by_user_id: producerMemberId,
              })
              .select("id")
              .single();

          expect(substituteError).toBeNull();

          const { error } =
            await clientProducerMember
              .from("emission_data")
              .update({ evidence_file_ids: [substitute!.id] })
              .eq("id", emissionDataId);

          expect(error).not.toBeNull();
          expect(error?.message).toContain("evidence cannot be removed");
        },
      );

      it(
        "B2.8 the supersede / re-verify workflow still works: a new version can " +
          "be created and activated, retiring the old one, with the old one's " +
          "evidence intact",
        async () => {
          const first = await createGenuinelyActiveVerifiedRecord();

          // A correction is a NEW version, which is the point: the
          // lock forbids rewriting history, not recording new facts.
          const { data: second, error: secondError } =
            await clientProducerMember
              .from("emission_data")
              .insert({
                installation_id: installationId,
                entered_by_org_id: producerOrgId,
                cn_scope: ["72081000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: first.reportingPeriodYear,
                direct_specific: "2.900",
                indirect_specific: "0.400",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                version: 2,
                predecessor_id: first.emissionDataId,
              })
              .select("id")
              .single();

          expect(secondError).toBeNull();

          const retire =
            await clientProducerMember
              .from("emission_data")
              .update({ status: "SUPERSEDED" })
              .eq("id", first.emissionDataId);

          expect(retire.error).toBeNull();

          const retired = await readRecord(first.emissionDataId);

          expect(retired.status).toBe("SUPERSEDED");
          expect(retired.verification_status).toBe("VERIFIED");
          expect(retired.evidence_file_ids).toEqual([first.evidenceFileId]);
          expect(retired.verified_active_at).not.toBeNull();

          // Cleanup: the v2 draft would otherwise collide with nothing,
          // but leaving it is untidy for the afterAll delete order.
          await serviceClient
            .from("emission_data")
            .delete()
            .eq("id", second!.id);
        },
      );

      it("B2.9 evidence may still GROW on an ACTIVE + VERIFIED record", async () => {
        const { emissionDataId, evidenceFileId } =
          await createGenuinelyActiveVerifiedRecord();

        const { data: extra, error: extraError } =
          await clientProducerMember
            .from("evidence_files")
            .insert({
              org_id: producerOrgId,
              emission_data_id: emissionDataId,
              storage_path: `${producerOrgId}/${emissionDataId}/${crypto.randomUUID()}.pdf`,
              original_filename: "annex-b.pdf",
              mime_type: "application/pdf",
              size_bytes: 4096,
              sha256: "d".repeat(64),
              uploaded_by_user_id: producerMemberId,
            })
            .select("id")
            .single();

        expect(extraError).toBeNull();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update({ evidence_file_ids: [evidenceFileId, extra!.id] })
            .eq("id", emissionDataId);

        expect(error).toBeNull();

        const record = await readRecord(emissionDataId);

        expect(record.evidence_file_ids).toHaveLength(2);
      });

      it("B2.10 the marker itself cannot be cleared", async () => {
        const { emissionDataId } = await createGenuinelyActiveVerifiedRecord();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update({ verified_active_at: null })
            .eq("id", emissionDataId);

        expect(error).not.toBeNull();
        expect(error?.message).toContain("verified_active_at is immutable");
      });

      it("B2.11 a DRAFT record's ordinary workflow is untouched: it can still be discarded", async () => {
        const { data: draft, error: draftError } =
          await clientProducerMember
            .from("emission_data")
            .insert(forgedInsert({}))
            .select("id")
            .single();

        expect(draftError).toBeNull();

        const { error } =
          await clientProducerMember
            .from("emission_data")
            .update({ status: "DISCARDED" })
            .eq("id", draft!.id);

        expect(error).toBeNull();
      });
    });
  },
);
