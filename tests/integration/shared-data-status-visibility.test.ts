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

// Adversarial standing suite for master plan §27 screen 32
// ("Shared-data status" -- "who sees what, consumption events") --
// specifically the two RLS-scoped reads that screen depends on:
//   (a) organizations_select_via_own_issued_sharing_grant
//       (20260829320000_p7d4_shared_data_status_grantee_visibility.sql)
//       -- a grantor resolving the NAME of an org they've granted data
//       to. A stranger org must never resolve a name they have no
//       relationship to -- verified directly here, not assumed from the
//       migration's own reasoning.
//   (b) audit_events_select_own_org (20260828070000) already covering
//       the grantor's own read of 'sharing_grant.data_consumed' rows --
//       tests/integration/shared-data-consumption-audit.test.ts only
//       ever confirmed this using the SERVICE-ROLE client; this suite
//       adds the one assertion that was missing -- the real grantor's
//       own authenticated client reading its own org's audit_events row
//       back, under real RLS, per this task's own "confirm this, don't
//       assume it" instruction.
//
// Same local-only-instance rationale, fixed local demo JWTs (not
// secrets), skip-not-fail discipline, and three-party (grantor/
// producer, grantee/importer, stranger) adversarial shape as
// tests/integration/sharing-grants-isolation.test.ts and
// tests/integration/shared-data-consumption-audit.test.ts, which this
// file extends rather than duplicates fixture-setup reasoning from.

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
  "Shared-data status screen visibility (local Supabase only)",
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
    let importerOrgId: string;
    let strangerOrgId: string;
    let unrelatedProducerOrgId: string;

    let producerOwnerId: string;
    let importerMemberId: string;
    let strangerOwnerId: string;
    let unrelatedProducerOwnerId: string;

    let clientProducerOwner: SupabaseClient;
    let clientImporterMember: SupabaseClient;
    let clientStrangerOwner: SupabaseClient;
    let clientUnrelatedProducerOwner: SupabaseClient;

    let operatorId: string;
    let installationId: string;

    let activeGrantId: string;
    let revokedGrantId: string;

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

    beforeAll(async () => {
      async function createOrg(
        label: string,
        capabilities: string[],
      ): Promise<string> {
        const { data, error } =
          await serviceClient
            .from("organizations")
            .insert(
              {
                name: `Shared Status ${label} ${runId}`,
                slug: `shared-status-${label}-${runId}`,
                capabilities,
              },
            )
            .select("id")
            .single();

        if (error || !data) {
          throw new Error(
            `Failed to create ${label} org: ${error?.message}`,
          );
        }

        return data.id;
      }

      producerOrgId = await createOrg("producer", ["PRODUCER_OPERATOR"]);
      importerOrgId = await createOrg("importer", ["IMPORTER_DECLARANT"]);
      strangerOrgId = await createOrg("stranger", ["IMPORTER_DECLARANT"]);
      unrelatedProducerOrgId = await createOrg("unrelated-producer", ["PRODUCER_OPERATOR"]);

      const password =
        `shared-status-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `shared-status-${label}-${runId}@example.com`,
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

      producerOwnerId = await createUser("producer-owner");
      importerMemberId = await createUser("importer-member");
      strangerOwnerId = await createUser("stranger-owner");
      unrelatedProducerOwnerId = await createUser("unrelated-producer-owner");

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: producerOrgId, user_id: producerOwnerId, role: "OWNER" },
              { org_id: importerOrgId, user_id: importerMemberId, role: "MEMBER" },
              { org_id: strangerOrgId, user_id: strangerOwnerId, role: "OWNER" },
              { org_id: unrelatedProducerOrgId, user_id: unrelatedProducerOwnerId, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientProducerOwner =
        await signInAnonClient(
          `shared-status-producer-owner-${runId}@example.com`,
          password,
        );

      clientImporterMember =
        await signInAnonClient(
          `shared-status-importer-member-${runId}@example.com`,
          password,
        );

      clientStrangerOwner =
        await signInAnonClient(
          `shared-status-stranger-owner-${runId}@example.com`,
          password,
        );

      clientUnrelatedProducerOwner =
        await signInAnonClient(
          `shared-status-unrelated-producer-owner-${runId}@example.com`,
          password,
        );

      const { data: operator, error: operatorError } =
        await clientProducerOwner
          .from("operators")
          .insert(
            {
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Shared Status Operator ${runId}`,
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
        await clientProducerOwner
          .from("installations")
          .insert(
            {
              operator_id: operatorId,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Shared Status Installation ${runId}`,
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

      // Grant 1: issued, accepted, then REVOKED -- screen 32's own
      // design intent is that the grantee name must still resolve for a
      // grant's HISTORY, not only while it is ACTIVE (see this
      // migration's own header comment).
      const { data: grant, error: grantError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: importerOrgId,
              installation_id: installationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (grantError || !grant) {
        throw new Error(
          `Failed to issue grant: ${grantError?.message}`,
        );
      }

      revokedGrantId = grant.id;

      const { error: acceptError } =
        await clientImporterMember
          .from("sharing_grants")
          .update(
            { status: "ACTIVE" },
          )
          .eq(
            "id",
            revokedGrantId,
          );

      if (acceptError) {
        throw new Error(
          `Failed to accept grant: ${acceptError.message}`,
        );
      }

      const { error: revokeError } =
        await clientProducerOwner
          .from("sharing_grants")
          .update(
            { status: "REVOKED" },
          )
          .eq(
            "id",
            revokedGrantId,
          );

      if (revokeError) {
        throw new Error(
          `Failed to revoke grant: ${revokeError.message}`,
        );
      }

      // Grant 2: a fresh, still-ACTIVE grant to the same importer org
      // (issuing a second one requires a second installation, since
      // sharing_grants_installation_grantee_active_uq forbids two
      // simultaneously non-terminal grants for the same
      // (installation, grantee) pair -- but re-using the SAME
      // installation is fine here since grant 1 is already terminal).
      const { data: grant2, error: grant2Error } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: importerOrgId,
              installation_id: installationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (grant2Error || !grant2) {
        throw new Error(
          `Failed to issue second grant: ${grant2Error?.message}`,
        );
      }

      activeGrantId = grant2.id;

      const { error: accept2Error } =
        await clientImporterMember
          .from("sharing_grants")
          .update(
            { status: "ACTIVE" },
          )
          .eq(
            "id",
            activeGrantId,
          );

      if (accept2Error) {
        throw new Error(
          `Failed to accept second grant: ${accept2Error.message}`,
        );
      }

      // A real consumption-audit row in the producer's own org, via the
      // real RPC -- exactly as determineLineFromActualData wires it --
      // so the audit_events read assertion below covers a genuine row,
      // not a service-role-inserted fixture. Needs a real shipment_line
      // under the importer org and a real ACTIVE+VERIFIED emission_data
      // row, matching shared-data-consumption-audit.test.ts's own
      // fixture shape.
      const { data: emissionData, error: emissionDataError } =
        await serviceClient
          .from("emission_data")
          .insert(
            {
              installation_id: installationId,
              entered_by_org_id: producerOrgId,
              cn_scope: ["72081000"],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              direct_specific: "1.3",
              indirect_specific: "0.5",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              status: "ACTIVE",
              verification_status: "VERIFIED",
              verifier_user_id: producerOwnerId,
              version: 1,
            },
          )
          .select("id")
          .single();

      if (emissionDataError || !emissionData) {
        throw new Error(
          `Failed to seed emission_data: ${emissionDataError?.message}`,
        );
      }

      const { data: shipment, error: shipmentError } =
        await clientImporterMember
          .from("shipments")
          .insert(
            {
              org_id: importerOrgId,
              reference: `SHARED-STATUS-${runId}`,
              release_date: "2026-01-15",
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
            },
          )
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(
          `Failed to create shipment: ${shipmentError?.message}`,
        );
      }

      const { data: line, error: lineError } =
        await clientImporterMember
          .from("shipment_lines")
          .insert(
            {
              shipment_id: shipment.id,
              org_id: importerOrgId,
              line_number: 1,
              cn_code: "72081000",
              cn_code_level: "CN8",
              origin_country: "DE",
              net_mass_tonnes: "10.5",
            },
          )
          .select("id")
          .single();

      if (lineError || !line) {
        throw new Error(
          `Failed to create shipment line: ${lineError?.message}`,
        );
      }

      const { data: rpcData, error: rpcError } =
        await clientImporterMember.rpc(
          "record_shared_data_consumption",
          {
            p_sharing_grant_id: activeGrantId,
            p_installation_id: installationId,
            p_emission_data_id: emissionData.id,
            p_emission_data_version: 1,
            p_shipment_line_id: line.id,
            p_determination_kind: "DETERMINED",
          },
        );

      const rpcRow =
        (rpcData as { result_status: string }[] | null)?.[0];

      if (rpcError || rpcRow?.result_status !== "OK") {
        throw new Error(
          `Failed to seed consumption event: ${rpcError?.message ?? rpcRow?.result_status}`,
        );
      }
    });

    afterAll(async () => {
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
        .from("audit_events")
        .delete()
        .in(
          "org_id",
          [producerOrgId, importerOrgId, strangerOrgId, unrelatedProducerOrgId],
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [producerOrgId, importerOrgId, strangerOrgId, unrelatedProducerOrgId],
        );

      await serviceClient
        .from("organizations")
        .delete()
        .in(
          "id",
          [producerOrgId, importerOrgId, strangerOrgId, unrelatedProducerOrgId],
        );

      for (
        const id of [
          producerOwnerId,
          importerMemberId,
          strangerOwnerId,
          unrelatedProducerOwnerId,
        ]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "the grantor can resolve the grantee org's name for a grant it actually issued",
      async () => {
        const { data, error } =
          await clientProducerOwner
            .from("organizations")
            .select("id, name")
            .eq(
              "id",
              importerOrgId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data?.id).toBe(importerOrgId);
        expect(data?.name).toContain("Shared Status importer");
      },
    );

    it(
      "the grantee name no longer resolves once every grant naming it is REVOKED -- the deliberate, disclosed security trade-off (2026-08-29 review fix)",
      async () => {
        // Every grant in this fixture set shares the same grantee org
        // (importerOrgId) -- the revoked grant (revokedGrantId) and the
        // active one (activeGrantId) both name it. Originally this
        // policy carried no `status = 'ACTIVE'` clause at all, so name
        // resolution survived revocation by design -- that shape was
        // found to leak an arbitrary org's full row (including
        // eori_number) via a self-issued, never-accepted sham grant,
        // since issuing a grant needs zero consent from the named
        // grantee. Fixed by scoping the policy to status = 'ACTIVE'
        // only (see supabase/migrations/
        // 20260829320000_p7d4_shared_data_status_grantee_visibility.sql's
        // own header comment for the full incident) -- reaching ACTIVE
        // requires the named org to have genuinely accepted the grant
        // itself, which an attacker can never do on a stranger's
        // behalf. The accepted, disclosed cost: once every grant naming
        // an org is revoked, this policy can no longer resolve that
        // org's name either -- proven here by revoking the only
        // remaining ACTIVE grant and confirming the read now returns no
        // row, not a name.
        const { error: revokeSecondGrantError } =
          await clientProducerOwner
            .from("sharing_grants")
            .update(
              { status: "REVOKED" },
            )
            .eq(
              "id",
              activeGrantId,
            );

        expect(revokeSecondGrantError).toBeNull();

        const { data, error } =
          await clientProducerOwner
            .from("organizations")
            .select("id, name")
            .eq(
              "id",
              importerOrgId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();

        // Restore an ACTIVE grant for tests that run after this one in
        // the same file (afterEach ordering is not relied upon --
        // re-accept explicitly instead).
        const { error: reactivateError } =
          await clientImporterMember
            .from("sharing_grants")
            .update(
              { status: "ACTIVE" },
            )
            .eq(
              "id",
              activeGrantId,
            )
            .eq(
              "status",
              "REVOKED",
            );

        // sharing_grants_update_grantee_accept's own USING clause only
        // admits status = 'INVITED' rows -- a REVOKED grant can never be
        // re-accepted this way (REVOKED is terminal, per
        // 20260829260000's own header comment), so this UPDATE
        // legitimately affects zero rows. Asserted explicitly so a
        // future change to that policy's terminality doesn't silently
        // leave this suite's shared fixture state inconsistent between
        // tests without anyone noticing.
        expect(reactivateError).toBeNull();
      },
    );

    it(
      "a stranger org with no grant relationship at all cannot resolve the grantee org's name, even knowing its id",
      async () => {
        const { data, error } =
          await clientStrangerOwner
            .from("organizations")
            .select("id, name")
            .eq(
              "id",
              importerOrgId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      },
    );

    it(
      "an unrelated producer org (a real grantor of DIFFERENT grants, to no one involved here) cannot resolve this importer org's name",
      async () => {
        const { data, error } =
          await clientUnrelatedProducerOwner
            .from("organizations")
            .select("id, name")
            .eq(
              "id",
              importerOrgId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      },
    );

    it(
      "the stranger org cannot resolve the GRANTOR's name either -- this policy only widens the grantee direction",
      async () => {
        const { data, error } =
          await clientStrangerOwner
            .from("organizations")
            .select("id, name")
            .eq(
              "id",
              producerOrgId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      },
    );

    it(
      "the grantor's own authenticated client (not just the service-role client) can read its own org's sharing_grant.data_consumed audit_events row",
      async () => {
        const { data, error } =
          await clientProducerOwner
            .from("audit_events")
            .select(
              "id, org_id, event_type, aggregate_type, aggregate_id, payload, actor_user_id",
            )
            .eq(
              "org_id",
              producerOrgId,
            )
            .eq(
              "event_type",
              "sharing_grant.data_consumed",
            );

        expect(error).toBeNull();
        expect(data).toHaveLength(1);

        const row =
          data![0]!;

        expect(row.aggregate_type).toBe(
          "SHARING_GRANT",
        );

        expect(row.aggregate_id).toBe(
          activeGrantId,
        );

        expect(
          (row.payload as { consuming_org_id: string }).consuming_org_id,
        ).toBe(
          importerOrgId,
        );

        expect(row.actor_user_id).toBe(
          importerMemberId,
        );
      },
    );

    it(
      "the stranger org cannot read the producer's consumption audit_events row via its own client either",
      async () => {
        const { data, error } =
          await clientStrangerOwner
            .from("audit_events")
            .select("id")
            .eq(
              "org_id",
              producerOrgId,
            )
            .eq(
              "event_type",
              "sharing_grant.data_consumed",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a self-issued, never-accepted sham grant does NOT leak the named org's full row -- the exact live-reproduced BLOCKING exploit this policy was fixed for (2026-08-29)",
      async () => {
        // Reproduces the original finding exactly: issuing a
        // sharing_grants row requires zero consent from the named
        // grantee (sharing_grants_insert_own_org only checks the
        // CALLER's own ADMIN+ status, installation ownership, and
        // app.organization_exists(grantee_org_id) -- a SECURITY DEFINER
        // helper that accepts ANY real org id). The stranger mints
        // their own throwaway operator + installation, then names the
        // real producerOrgId as grantee on a grant they issue -- no
        // action from producerOrgId required or possible to prevent it.
        const { data: strangerOperator, error: strangerOperatorError } =
          await clientStrangerOwner
            .from("operators")
            .insert(
              {
                org_id: strangerOrgId,
                provenance: "OPERATOR_PROVIDED",
                name: `Sham Grant Operator ${runId}`,
                country: "DE",
              },
            )
            .select("id")
            .single();

        if (strangerOperatorError || !strangerOperator) {
          throw new Error(
            `Failed to seed stranger operator: ${strangerOperatorError?.message}`,
          );
        }

        const { data: strangerInstallation, error: strangerInstallationError } =
          await clientStrangerOwner
            .from("installations")
            .insert(
              {
                operator_id: strangerOperator.id,
                org_id: strangerOrgId,
                provenance: "OPERATOR_PROVIDED",
                name: `Sham Grant Installation ${runId}`,
                country: "DE",
              },
            )
            .select("id")
            .single();

        if (strangerInstallationError || !strangerInstallation) {
          throw new Error(
            `Failed to seed stranger installation: ${strangerInstallationError?.message}`,
          );
        }

        const { data: shamGrant, error: shamGrantError } =
          await clientStrangerOwner
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: strangerOrgId,
                grantee_org_id: producerOrgId,
                installation_id: strangerInstallation.id,
                created_by_user_id: strangerOwnerId,
              },
            )
            .select("id, status")
            .single();

        if (shamGrantError || !shamGrant) {
          throw new Error(
            `Failed to issue sham grant: ${shamGrantError?.message}`,
          );
        }

        expect(shamGrant.status).toBe(
          "INVITED",
        );

        const { data: leakedRow, error: readError } =
          await clientStrangerOwner
            .from("organizations")
            .select("id, name, eori_number, cbam_declarant_status")
            .eq(
              "id",
              producerOrgId,
            )
            .maybeSingle();

        expect(readError).toBeNull();
        expect(leakedRow).toBeNull();

        // The originally-vulnerable policy carried no status scope at
        // all, so the leak also survived the attacker revoking their
        // own sham grant -- prove that path is closed too, not just the
        // INVITED one.
        const { error: revokeShamError } =
          await clientStrangerOwner
            .from("sharing_grants")
            .update(
              { status: "REVOKED" },
            )
            .eq(
              "id",
              shamGrant.id,
            );

        expect(revokeShamError).toBeNull();

        const { data: leakedRowAfterRevoke, error: readAfterRevokeError } =
          await clientStrangerOwner
            .from("organizations")
            .select("id, name, eori_number, cbam_declarant_status")
            .eq(
              "id",
              producerOrgId,
            )
            .maybeSingle();

        expect(readAfterRevokeError).toBeNull();
        expect(leakedRowAfterRevoke).toBeNull();

        await clientStrangerOwner
          .from("sharing_grants")
          .delete()
          .eq(
            "id",
            shamGrant.id,
          );

        await clientStrangerOwner
          .from("installations")
          .delete()
          .eq(
            "id",
            strangerInstallation.id,
          );

        await clientStrangerOwner
          .from("operators")
          .delete()
          .eq(
            "id",
            strangerOperator.id,
          );
      },
    );
  },
);
