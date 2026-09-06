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

// Snowkap CBAM SME Experience v2.1.1, S4:
// emission_data_declaration_context and emission_data_precursors
// (20260906180000_s4_declaration_context_and_precursors.sql).
// Structurally mirrors guidance-dismissals-isolation.test.ts: real
// local Supabase, real auth users, real cross-tenant proof, not mocked.
// Runs against LOCAL, disposable Supabase only; skips cleanly when
// unreachable.

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
  "emission_data_declaration_context / emission_data_precursors RLS -- cross-org isolation (local Supabase only)",
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
        { auth: { persistSession: false } },
      );

    let orgAId: string;
    let orgBId: string;
    let memberAId: string;
    let memberBId: string;
    let ownerAId: string;
    let operatorId: string;
    let installationId: string;
    let emissionDataId: string;
    let contextId: string;
    let precursorId: string;
    let secondEmissionDataId: string | undefined;
    let lockedEmissionDataId: string;
    let lockedContextId: string;
    let draftVerifiedEmissionDataId: string;
    let draftVerifiedContextId: string;
    let draftVerifiedPrecursorId: string;

    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let ownerAClient: SupabaseClient;

    async function signInAnonClient(
      email: string,
      password: string,
    ): Promise<SupabaseClient> {
      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error } =
        await client.auth.signInWithPassword(
          { email, password },
        );

      if (error) {
        throw new Error(
          `Failed to sign in ${email}: ${error.message}`,
        );
      }

      return client;
    }

    beforeAll(async () => {
      const { data: orgA, error: orgAError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S4 Dossier Test Org A ${runId}`,
              slug: `s4-dossier-test-org-a-${runId}`,
              capabilities: ["PRODUCER_OPERATOR"],
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
              name: `S4 Dossier Test Org B ${runId}`,
              slug: `s4-dossier-test-org-b-${runId}`,
              capabilities: ["PRODUCER_OPERATOR"],
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
        `s4-dossier-test-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `s4-dossier-${label}-${runId}@example.com`,
              password,
              email_confirm: true,
            },
          );

        if (error || !data.user) {
          throw new Error(
            `Failed to create user ${label}: ${error?.message}`,
          );
        }

        return data.user.id;
      }

      memberAId =
        await createUser(
          "member-a",
        );

      memberBId =
        await createUser(
          "member-b",
        );

      // 2026-09-06 (S5 review remediation, findings AUTHZ-B1/S5R-B1). A
      // real ADMIN/OWNER is needed to transition a fixture record's
      // verification_status into VERIFIED via a genuine authenticated
      // UPDATE -- app.enforce_emission_data_verification_gate refuses
      // that transition for anyone who isn't (service_role's own
      // auth.uid() is null, so it cannot satisfy this gate either, same
      // as an ordinary MEMBER). Needed now that the dossier lock covers
      // INSERT too (20260906260000): a "locked" fixture's dossier rows
      // must be created BEFORE the parent record is locked, which means
      // walking the parent through a real verification transition
      // rather than inserting it pre-locked from birth.
      ownerAId =
        await createUser(
          "owner-a",
        );

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: orgAId, user_id: memberAId, role: "MEMBER" },
              { org_id: orgBId, user_id: memberBId, role: "MEMBER" },
              { org_id: orgAId, user_id: ownerAId, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientA =
        await signInAnonClient(
          `s4-dossier-member-a-${runId}@example.com`,
          password,
        );

      clientB =
        await signInAnonClient(
          `s4-dossier-member-b-${runId}@example.com`,
          password,
        );

      ownerAClient =
        await signInAnonClient(
          `s4-dossier-owner-a-${runId}@example.com`,
          password,
        );

      const { data: operator, error: operatorError } =
        await serviceClient
          .from("operators")
          .insert(
            {
              org_id: orgAId,
              provenance: "OPERATOR_PROVIDED",
              name: `S4 Dossier Test Operator ${runId}`,
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
        await serviceClient
          .from("installations")
          .insert(
            {
              operator_id: operatorId,
              org_id: orgAId,
              provenance: "OPERATOR_PROVIDED",
              name: `S4 Dossier Test Installation ${runId}`,
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

      const { data: emissionData, error: emissionDataError } =
        await serviceClient
          .from("emission_data")
          .insert(
            {
              installation_id: installationId,
              entered_by_org_id: orgAId,
              cn_scope: ["25231000"],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              direct_specific: "1.0",
              indirect_specific: "0.5",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              status: "DRAFT",
              verification_status: "UNVERIFIED",
              version: 1,
            },
          )
          .select("id")
          .single();

      if (emissionDataError || !emissionData) {
        throw new Error(
          `Failed to create emission_data: ${emissionDataError?.message}`,
        );
      }

      emissionDataId = emissionData.id;
    });

    afterAll(async () => {
      // emission_data FIRST, relying on ON DELETE CASCADE for the two
      // dossier tables -- not the other way around. The "post-
      // verification lock" tests below deliberately walk emissionDataId
      // to ACTIVE+VERIFIED, at which point app.enforce_dossier_lock
      // (20260906200000, S4 remediation, closes B2) permanently refuses
      // direct UPDATE/DELETE on its declaration_context/precursor rows.
      // Deleting the parent first works: by the time the FK cascade
      // reaches the child rows, this same transaction has already
      // removed the parent, so the trigger's own "parent no longer
      // exists -- not a lock to enforce here" branch applies (see that
      // function's comment). secondEmissionDataId (created only by the
      // emission_data_id-immutability test below) never gained any
      // dossier rows of its own, so a plain delete is enough for it.
      // lockedEmissionDataId is the separate ACTIVE+VERIFIED fixture the
      // lock tests create -- its own context/precursor rows are locked
      // the same way, so it needs the same parent-first deletion order.
      // draftVerifiedEmissionDataId (S5) is likewise locked once
      // verification_status='VERIFIED', even while status stays DRAFT.
      await serviceClient
        .from("emission_data")
        .delete()
        .in(
          "id",
          [
            emissionDataId,
            ...(secondEmissionDataId ? [secondEmissionDataId] : []),
            ...(lockedEmissionDataId ? [lockedEmissionDataId] : []),
            ...(draftVerifiedEmissionDataId ? [draftVerifiedEmissionDataId] : []),
          ],
        );

      await serviceClient
        .from("installations")
        .delete()
        .eq(
          "id",
          installationId,
        );

      await serviceClient
        .from("operators")
        .delete()
        .eq(
          "id",
          operatorId,
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      // audit_events_org_id_fkey is ON DELETE RESTRICT (audit_events is
      // append-only by design, never cascaded away implicitly) -- the
      // B1 regression tests above deliberately write real rows here, so
      // without this the organizations delete below fails silently
      // (supabase-js doesn't throw) and both test orgs leak permanently.
      await serviceClient
        .from("audit_events")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      const { error: deleteOrgsError } =
        await serviceClient
          .from("organizations")
          .delete()
          .in(
            "id",
            [orgAId, orgBId],
          );

      if (deleteOrgsError) {
        throw new Error(
          `Failed to delete test organizations during cleanup -- would otherwise leak silently: ${deleteOrgsError.message}`,
        );
      }

      for (
        const userId of [memberAId, memberBId, ownerAId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "org A's own member can insert a declaration context for org A's own emission_data row",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                production_process_description: "Kiln-fired at 900C",
                uses_purchased_precursors: true,
              },
            )
            .select("id")
            .single();

        expect(error).toBeNull();
        expect(data?.id).toBeTruthy();

        contextId = data!.id;
      },
    );

    it(
      "a stranger org's member cannot see org A's declaration context -- RLS silently filters to zero rows",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_declaration_context")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger org's member cannot insert a declaration context claiming org A's emission_data row -- refused by the cross-parent EXISTS check even if they somehow supplied their own org_id",
      async () => {
        const { error } =
          await clientB
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgBId,
                emission_data_id: emissionDataId,
                production_process_description: "Stranger's claim",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a stranger org's member cannot update org A's declaration context",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_declaration_context")
            .update(
              { production_process_description: "Tampered" },
            )
            .eq(
              "id",
              contextId,
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );

        const { data: unchanged } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "id",
              contextId,
            )
            .single();

        expect(unchanged?.production_process_description).toBe(
          "Kiln-fired at 900C",
        );
      },
    );

    it(
      "org A's own member CAN update their own declaration context",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .update(
              { verifier_report_declared: true, verifier_report_description: "TUV Rheinland, 2026-02" },
            )
            .eq(
              "id",
              contextId,
            )
            .select(
              "verifier_report_declared",
            )
            .single();

        expect(error).toBeNull();
        expect(data?.verifier_report_declared).toBe(
          true,
        );
      },
    );

    it(
      "a verifier report description without declaring one exists is refused by the CHECK constraint",
      async () => {
        const { error } =
          await serviceClient
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                verifier_report_declared: false,
                verifier_report_description: "Should be refused",
              },
            );

        // Also collides with the one-per-record unique constraint, but
        // even a fresh emission_data_id would hit the CHECK first --
        // this row is refused either way, which is what matters here.
        expect(error).not.toBeNull();
      },
    );

    it(
      "org A's own member can add a precursor with ACTUAL_WITH_DECLARED_REPORT provenance",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                material_description: "Clinker, purchased",
                cn_code: "25231000",
                source_description: "Acme Cement, DE",
                direct_specific: "0.850",
                indirect_specific: "0.120",
                emission_unit: "tCO2e/t",
                provenance: "ACTUAL_WITH_DECLARED_REPORT",
                verifier_report_description: "TUV Rheinland, 2026-02",
              },
            )
            .select("id")
            .single();

        expect(error).toBeNull();
        expect(data?.id).toBeTruthy();

        precursorId = data!.id;
      },
    );

    it(
      "a verifier report description on a precursor without ACTUAL_WITH_DECLARED_REPORT provenance is refused by the CHECK constraint",
      async () => {
        const { error } =
          await serviceClient
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                material_description: "Second precursor",
                provenance: "UNKNOWN",
                verifier_report_description: "Should be refused",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a non-canonical decimal string on direct_specific is refused -- same grammar as emission_data's own numeric CHECK",
      async () => {
        const { error } =
          await serviceClient
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                material_description: "Bad number precursor",
                direct_specific: "1_0",
                provenance: "UNKNOWN",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a stranger org's member cannot see org A's precursors",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_precursors")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger org's member cannot delete org A's precursor",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_precursors")
            .delete()
            .eq(
              "id",
              precursorId,
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );

        const { data: stillThere } =
          await serviceClient
            .from("emission_data_precursors")
            .select(
              "id",
            )
            .eq(
              "id",
              precursorId,
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );

    it(
      "org A's own member CAN delete their own precursor",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .delete()
            .eq(
              "id",
              precursorId,
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toHaveLength(
          1,
        );
      },
    );

    // ------------------------------------------------------------
    // S4 remediation (20260906200000), Blocking Finding B1: every S4
    // audit event (declaration_context.upserted, precursor.added,
    // precursor.removed) was silently refused by audit_events_insert_
    // own_org_as_self's own event_type allowlist -- a catalog separate
    // from, and never widened alongside, the aggregate_type CHECK
    // 20260906180000 did widen. Proven live: org A's own member,
    // exactly as recordAuditEvent (src/application/audit/record-audit-
    // event.ts) does it on the real client-side write path.
    // ------------------------------------------------------------
    it(
      "org A's own member can record a declaration_context.upserted audit event -- the S4 event types are in the catalog",
      async () => {
        const { error } =
          await clientA
            .from("audit_events")
            .insert(
              {
                org_id: orgAId,
                actor_type: "USER",
                actor_user_id: memberAId,
                event_type: "declaration_context.upserted",
                aggregate_type: "DECLARATION_CONTEXT",
                aggregate_id: contextId,
                payload: {},
              },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "org A's own member can record a precursor.added audit event",
      async () => {
        const { error } =
          await clientA
            .from("audit_events")
            .insert(
              {
                org_id: orgAId,
                actor_type: "USER",
                actor_user_id: memberAId,
                event_type: "precursor.added",
                aggregate_type: "PRECURSOR",
                aggregate_id: crypto.randomUUID(),
                payload: {},
              },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "org A's own member can record a precursor.removed audit event",
      async () => {
        const { error } =
          await clientA
            .from("audit_events")
            .insert(
              {
                org_id: orgAId,
                actor_type: "USER",
                actor_user_id: memberAId,
                event_type: "precursor.removed",
                aggregate_type: "PRECURSOR",
                aggregate_id: crypto.randomUUID(),
                payload: {},
              },
            );

        expect(error).toBeNull();
      },
    );

    // ------------------------------------------------------------
    // S4 remediation (20260906200000), Blocking Finding B2: an ordinary
    // member of the owning org could UPDATE a declared verifier-report
    // claim or DELETE a declared precursor outright on a record that
    // had genuinely walked to ACTIVE+VERIFIED -- the app-layer check
    // (verifyEmissionDataEditable) is the only wall that existed;
    // app.enforce_dossier_lock adds the second one, mirroring app.
    // enforce_emission_data_lineage_lock's own durable-marker design one
    // level down. Proven live, in this order, against the SAME
    // emissionDataId/contextId used by the editable-state tests above --
    // deliberately run last in this file so the lock this section
    // applies does not interfere with any of the "still editable" cases
    // above it.
    // ------------------------------------------------------------
    it(
      "a producer cannot repoint an existing declaration context at a different emission_data row -- emission_data_id is immutable",
      async () => {
        const { data: secondRow, error: secondRowError } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: installationId,
                entered_by_org_id: orgAId,
                cn_scope: ["25231000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2027,
                direct_specific: "1.0",
                indirect_specific: "0.5",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                status: "DRAFT",
                verification_status: "UNVERIFIED",
                version: 1,
              },
            )
            .select("id")
            .single();

        if (secondRowError || !secondRow) {
          throw new Error(
            `Failed to create second emission_data row: ${secondRowError?.message}`,
          );
        }

        secondEmissionDataId = secondRow.id;

        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .update(
              { emission_data_id: secondEmissionDataId },
            )
            .eq(
              "id",
              contextId,
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        const { data: unchanged } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "emission_data_id",
            )
            .eq(
              "id",
              contextId,
            )
            .single();

        expect(unchanged?.emission_data_id).toBe(
          emissionDataId,
        );
      },
    );

    // The remaining lock tests use a SEPARATE emission_data row, walked
    // to ACTIVE+VERIFIED rather than inserted pre-locked from birth.
    //
    // 2026-09-06 (S5 review remediation, findings AUTHZ-B1/S5R-B1): the
    // dossier lock now covers INSERT too (20260906260000), and that
    // trigger binds every role -- including service_role, whose own
    // auth.uid() is null -- matching the sibling parent-table lock's own
    // established all-roles posture. A dossier row can therefore no
    // longer be attached to an already-locked record at all, by ANY
    // client. The fixture must create the dossier row FIRST, while the
    // parent is still DRAFT+UNVERIFIED (unlocked), then walk the parent
    // through a REAL verification transition as the real OWNER
    // (ownerAClient) -- service_role cannot satisfy
    // app.enforce_emission_data_verification_gate's ADMIN-or-OWNER check
    // either (20260829480000), for the identical auth.uid()-is-null
    // reason.
    it(
      "once a record is ACTIVE and VERIFIED, its declaration context can no longer be edited by anyone in the owning org -- not just a stranger",
      async () => {
        const { data: lockedRow, error: lockedRowError } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: installationId,
                entered_by_org_id: orgAId,
                cn_scope: ["25231000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2028,
                direct_specific: "1.0",
                indirect_specific: "0.5",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                status: "DRAFT",
                verification_status: "UNVERIFIED",
                version: 1,
              },
            )
            .select("id")
            .single();

        if (lockedRowError || !lockedRow) {
          throw new Error(
            `Failed to create the pre-lock emission_data row: ${lockedRowError?.message}`,
          );
        }

        lockedEmissionDataId = lockedRow.id;

        const { data: lockedContext, error: lockedContextError } =
          await serviceClient
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: lockedEmissionDataId,
                production_process_description: "Kiln-fired at 900C, already verified",
              },
            )
            .select("id")
            .single();

        if (lockedContextError || !lockedContext) {
          throw new Error(
            `Failed to create the locked row's declaration context: ${lockedContextError?.message}`,
          );
        }

        lockedContextId = lockedContext.id;

        const { error: verifyError } =
          await ownerAClient
            .from("emission_data")
            .update(
              { verification_status: "VERIFICATION_PENDING" },
            )
            .eq(
              "id",
              lockedEmissionDataId,
            );

        if (verifyError) {
          throw new Error(
            `Failed to move the fixture to VERIFICATION_PENDING: ${verifyError.message}`,
          );
        }

        // 2026-09-07 (S5 review round 5, finding S5R5-AUTHZ-Y1): a
        // transition INTO VERIFIED now requires non-empty evidence at
        // the DB layer too, matching the real application's own
        // pre-existing requirement (applyTransition's VERIFY branch,
        // manage-emission-data.ts).
        const { data: lockedEvidence, error: lockedEvidenceError } =
          await serviceClient
            .from("evidence_files")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: lockedEmissionDataId,
                storage_path: `${orgAId}/${lockedEmissionDataId}/lock-fixture.pdf`,
                original_filename: "lock-fixture.pdf",
                mime_type: "application/pdf",
                size_bytes: 1024,
                sha256: "c".repeat(64),
                uploaded_by_user_id: ownerAId,
              },
            )
            .select("id")
            .single();

        if (lockedEvidenceError || !lockedEvidence) {
          throw new Error(
            `Failed to seed evidence for the fixture: ${lockedEvidenceError?.message}`,
          );
        }

        const { error: lockedLinkError } =
          await serviceClient
            .from("emission_data")
            .update(
              { evidence_file_ids: [lockedEvidence.id] },
            )
            .eq(
              "id",
              lockedEmissionDataId,
            );

        if (lockedLinkError) {
          throw new Error(
            `Failed to link evidence for the fixture: ${lockedLinkError.message}`,
          );
        }

        const { error: verifiedError } =
          await ownerAClient
            .from("emission_data")
            .update(
              { verification_status: "VERIFIED", verifier_user_id: ownerAId },
            )
            .eq(
              "id",
              lockedEmissionDataId,
            );

        if (verifiedError) {
          throw new Error(
            `Failed to verify the fixture: ${verifiedError.message}`,
          );
        }

        // No longer overrides evidence_file_ids with a dummy,
        // non-existent id here -- real evidence was already attached
        // above before VERIFY, and the verification gate's own
        // "evidence cannot shrink from a VERIFIED record" rule
        // (S5R3-AUTHZ-B1) would refuse replacing it with a different
        // array anyway.
        const { error: activateError } =
          await serviceClient
            .from("emission_data")
            .update(
              { status: "ACTIVE" },
            )
            .eq(
              "id",
              lockedEmissionDataId,
            );

        if (activateError) {
          throw new Error(
            `Failed to activate the fixture: ${activateError.message}`,
          );
        }

        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .update(
              { production_process_description: "Tampered after verification" },
            )
            .eq(
              "id",
              lockedContextId,
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        const { data: unchanged } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "id",
              lockedContextId,
            )
            .single();

        expect(unchanged?.production_process_description).toBe(
          "Kiln-fired at 900C, already verified",
        );
      },
    );

    it(
      "...and its declaration context can no longer be deleted either",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .delete()
            .eq(
              "id",
              lockedContextId,
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        const { data: stillThere } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "id",
            )
            .eq(
              "id",
              lockedContextId,
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding AUTHZ-B1/S5R-B1): a NEW declaration context can no longer be INSERTed onto it either -- the lock trigger previously covered UPDATE/DELETE only, so an ordinary MEMBER could inject a fabricated verifier-report declaration onto an already-published, cross-org-shared record",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: lockedEmissionDataId,
                production_process_description: "S5REVIEW injected post-verification",
                verifier_report_declared: true,
                verifier_report_description: "S5REVIEW fabricated verifier report",
              },
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        const { data: rows } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "id",
            )
            .eq(
              "emission_data_id",
              lockedEmissionDataId,
            );

        expect(rows).toHaveLength(
          1,
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding AUTHZ-B1/S5R-B1): a NEW precursor can no longer be INSERTed onto it either",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: lockedEmissionDataId,
                material_description: "S5REVIEW injected precursor",
                provenance: "UNKNOWN",
              },
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();
      },
    );

    // 2026-09-06 (S5 review remediation, findings AUTHZ-B1/S5R-B1). This
    // slot previously held "...and a precursor declared against it can
    // no longer be deleted, even one added after the lock took effect"
    // -- a test that itself relied on the exact gap AUTHZ-B1/S5R-B1
    // found: inserting a NEW precursor onto an already-locked record via
    // serviceClient, which the pre-fix trigger (UPDATE/DELETE only)
    // silently admitted for every role. Now that the lock covers INSERT
    // too (20260906260000), that setup step itself fails -- the scenario
    // "a precursor exists AND was added after the lock" is no longer
    // reachable by any client, which is the fix working as intended. The
    // "...a NEW declaration context/precursor can no longer be INSERTed
    // onto it either" tests above are the direct replacement coverage.

    // S5 cross-phase hardening (20260906230000). app.enforce_dossier_lock
    // used to fire only once verified_active_at was set, which happens
    // only once a record is ACTIVE+VERIFIED together -- leaving the
    // whole DRAFT+VERIFIED window (verifyEmissionData and
    // activateEmissionData are separate, non-atomic actions) completely
    // unprotected at the database layer. Widened to lock the moment the
    // parent leaves DRAFT OR is VERIFIED, matching verifyEmissionData
    // Editable's own app-layer condition.
    it(
      "once a record is VERIFIED -- even while it is still DRAFT, not yet ACTIVE -- its declaration context can no longer be edited by anyone in the owning org",
      async () => {
        // 2026-09-06 (S5 review remediation, findings AUTHZ-B1/S5R-B1):
        // insert as DRAFT+UNVERIFIED first (unlocked), attach the
        // dossier rows, THEN walk verification_status to VERIFIED as
        // the real OWNER -- see the identical reasoning on the
        // ACTIVE+VERIFIED fixture above. status stays DRAFT throughout;
        // only verification_status moves.
        const { data: draftVerifiedRow, error: draftVerifiedRowError } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: installationId,
                entered_by_org_id: orgAId,
                cn_scope: ["25231000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2029,
                direct_specific: "1.0",
                indirect_specific: "0.5",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                status: "DRAFT",
                verification_status: "UNVERIFIED",
                version: 1,
              },
            )
            .select("id")
            .single();

        if (draftVerifiedRowError || !draftVerifiedRow) {
          throw new Error(
            `Failed to create the pre-lock emission_data row: ${draftVerifiedRowError?.message}`,
          );
        }

        draftVerifiedEmissionDataId = draftVerifiedRow.id;

        const { data: draftVerifiedContext, error: draftVerifiedContextError } =
          await serviceClient
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: draftVerifiedEmissionDataId,
                production_process_description: "Kiln-fired, verified but not yet activated",
              },
            )
            .select("id")
            .single();

        if (draftVerifiedContextError || !draftVerifiedContext) {
          throw new Error(
            `Failed to create the DRAFT+VERIFIED row's declaration context: ${draftVerifiedContextError?.message}`,
          );
        }

        draftVerifiedContextId = draftVerifiedContext.id;

        const { data: draftVerifiedPrecursor, error: draftVerifiedPrecursorError } =
          await serviceClient
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: draftVerifiedEmissionDataId,
                material_description: "Precursor on a DRAFT+VERIFIED record, for the S5 lock regression test",
                provenance: "UNKNOWN",
              },
            )
            .select("id")
            .single();

        if (draftVerifiedPrecursorError || !draftVerifiedPrecursor) {
          throw new Error(
            `Failed to create the DRAFT+VERIFIED row's precursor: ${draftVerifiedPrecursorError?.message}`,
          );
        }

        draftVerifiedPrecursorId = draftVerifiedPrecursor.id;

        const { error: pendingError } =
          await ownerAClient
            .from("emission_data")
            .update(
              { verification_status: "VERIFICATION_PENDING" },
            )
            .eq(
              "id",
              draftVerifiedEmissionDataId,
            );

        if (pendingError) {
          throw new Error(
            `Failed to move the DRAFT+VERIFIED fixture to VERIFICATION_PENDING: ${pendingError.message}`,
          );
        }

        // 2026-09-07 (S5 review round 5, finding S5R5-AUTHZ-Y1): a
        // transition INTO VERIFIED now requires non-empty evidence at
        // the DB layer too, matching the real application's own
        // pre-existing requirement (applyTransition's VERIFY branch,
        // manage-emission-data.ts).
        const { data: draftVerifiedEvidence, error: draftVerifiedEvidenceError } =
          await serviceClient
            .from("evidence_files")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: draftVerifiedEmissionDataId,
                storage_path: `${orgAId}/${draftVerifiedEmissionDataId}/draft-verified-fixture.pdf`,
                original_filename: "draft-verified-fixture.pdf",
                mime_type: "application/pdf",
                size_bytes: 1024,
                sha256: "d".repeat(64),
                uploaded_by_user_id: ownerAId,
              },
            )
            .select("id")
            .single();

        if (draftVerifiedEvidenceError || !draftVerifiedEvidence) {
          throw new Error(
            `Failed to seed evidence for the DRAFT+VERIFIED fixture: ${draftVerifiedEvidenceError?.message}`,
          );
        }

        const { error: draftVerifiedLinkError } =
          await serviceClient
            .from("emission_data")
            .update(
              { evidence_file_ids: [draftVerifiedEvidence.id] },
            )
            .eq(
              "id",
              draftVerifiedEmissionDataId,
            );

        if (draftVerifiedLinkError) {
          throw new Error(
            `Failed to link evidence for the DRAFT+VERIFIED fixture: ${draftVerifiedLinkError.message}`,
          );
        }

        const { error: verifiedError } =
          await ownerAClient
            .from("emission_data")
            .update(
              { verification_status: "VERIFIED", verifier_user_id: ownerAId },
            )
            .eq(
              "id",
              draftVerifiedEmissionDataId,
            );

        if (verifiedError) {
          throw new Error(
            `Failed to verify the DRAFT+VERIFIED fixture: ${verifiedError.message}`,
          );
        }

        const { data: draftVerifiedRowCheck } =
          await serviceClient
            .from("emission_data")
            .select("status, verification_status, verified_active_at")
            .eq("id", draftVerifiedEmissionDataId)
            .single();

        // Confirms the fixture actually reached the state under test --
        // status stays DRAFT and verified_active_at stays null, unlike
        // the ACTIVE+VERIFIED fixture above.
        expect(draftVerifiedRowCheck?.status).toBe(
          "DRAFT",
        );

        expect(draftVerifiedRowCheck?.verification_status).toBe(
          "VERIFIED",
        );

        expect(draftVerifiedRowCheck?.verified_active_at).toBeNull();

        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .update(
              { production_process_description: "Tampered while DRAFT+VERIFIED" },
            )
            .eq(
              "id",
              draftVerifiedContextId,
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        const { data: unchanged } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "id",
              draftVerifiedContextId,
            )
            .single();

        expect(unchanged?.production_process_description).toBe(
          "Kiln-fired, verified but not yet activated",
        );
      },
    );

    it(
      "...and a precursor declared against the same DRAFT+VERIFIED record can no longer be deleted",
      async () => {
        // 2026-09-06 (S5 review remediation, findings AUTHZ-B1/S5R-B1):
        // uses the precursor created BEFORE the fixture's lock took
        // effect (draftVerifiedPrecursorId, set up in the previous
        // test) -- a fresh INSERT here would itself now be refused,
        // which is the fix working as intended, not a gap.
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .delete()
            .eq(
              "id",
              draftVerifiedPrecursorId,
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        const { data: stillThere } =
          await serviceClient
            .from("emission_data_precursors")
            .select(
              "id",
            )
            .eq(
              "id",
              draftVerifiedPrecursorId,
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding AUTHZ-B1/S5R-B1): a NEW precursor can no longer be INSERTed onto a DRAFT+VERIFIED record either",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: draftVerifiedEmissionDataId,
                material_description: "S5REVIEW injected precursor on DRAFT+VERIFIED",
                provenance: "UNKNOWN",
              },
            )
            .select(
              "id",
            );

        expect(error).not.toBeNull();
        expect(data).toBeNull();
      },
    );
  },
);
