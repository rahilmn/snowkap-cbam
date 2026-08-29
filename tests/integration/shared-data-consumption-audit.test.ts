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

// Adversarial standing suite for record_shared_data_consumption()
// (supabase/migrations/20260829310000_p7d3_shared_data_consumption_audit.sql)
// -- the SECURITY DEFINER RPC that lets a GRANTOR org's own audit_events
// table learn a member of the GRANTEE org actually consumed (froze an
// ActualEmissionSnapshot from) their shared emission_data. S8
// (previously-deferred gap, master plan §9: "consumption events ...
// recorded on BOTH orgs' audit streams"). Same local-only-instance
// rationale, fixed local demo JWTs (not secrets), skip-not-fail
// discipline, and three-party (producer/grantor, importer/grantee,
// stranger) adversarial shape as
// tests/integration/sharing-grants-isolation.test.ts, which this file
// extends rather than duplicates fixture-setup reasoning from.

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

interface RpcRow {
  result_status: string;
  result_audit_event_id: string | null;
}

async function callRpc(
  client: SupabaseClient,
  args: {
    p_sharing_grant_id: string;
    p_installation_id: string;
    p_emission_data_id: string;
    p_emission_data_version: number;
    p_shipment_line_id: string;
    p_determination_kind: string;
  },
): Promise<RpcRow | undefined> {
  const { data } =
    await client.rpc(
      "record_shared_data_consumption",
      args,
    );

  return (data as RpcRow[] | null)?.[0];
}

describe.skipIf(!localSupabaseReachable)(
  "record_shared_data_consumption RPC (local Supabase only)",
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

    let producerOwnerId: string;
    let importerOwnerId: string;
    let importerMemberId: string;
    let strangerOwnerId: string;

    let clientProducerOwner: SupabaseClient;
    let clientImporterOwner: SupabaseClient;
    let clientImporterMember: SupabaseClient;
    let clientStrangerOwner: SupabaseClient;

    let operatorId: string;
    let installationId: string;
    let revokedInstallationId: string;
    let activeVerifiedEmissionDataId: string;

    let grantId: string;
    let revokedGrantId: string;

    let shipmentId: string;
    let lineId: string;

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
      const { data: producerOrg, error: producerOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Consumption Audit Producer ${runId}`,
              slug: `consumption-audit-producer-${runId}`,
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

      const { data: importerOrg, error: importerOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Consumption Audit Importer ${runId}`,
              slug: `consumption-audit-importer-${runId}`,
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

      const { data: strangerOrg, error: strangerOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Consumption Audit Stranger ${runId}`,
              slug: `consumption-audit-stranger-${runId}`,
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

      strangerOrgId = strangerOrg.id;

      const password =
        `consumption-audit-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `consumption-audit-${label}-${runId}@example.com`,
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
      importerOwnerId = await createUser("importer-owner");
      importerMemberId = await createUser("importer-member");
      strangerOwnerId = await createUser("stranger-owner");

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: producerOrgId, user_id: producerOwnerId, role: "OWNER" },
              { org_id: importerOrgId, user_id: importerOwnerId, role: "OWNER" },
              { org_id: importerOrgId, user_id: importerMemberId, role: "MEMBER" },
              { org_id: strangerOrgId, user_id: strangerOwnerId, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientProducerOwner =
        await signInAnonClient(
          `consumption-audit-producer-owner-${runId}@example.com`,
          password,
        );

      clientImporterOwner =
        await signInAnonClient(
          `consumption-audit-importer-owner-${runId}@example.com`,
          password,
        );

      clientImporterMember =
        await signInAnonClient(
          `consumption-audit-importer-member-${runId}@example.com`,
          password,
        );

      clientStrangerOwner =
        await signInAnonClient(
          `consumption-audit-stranger-owner-${runId}@example.com`,
          password,
        );

      const { data: operator, error: operatorError } =
        await clientProducerOwner
          .from("operators")
          .insert(
            {
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Consumption Audit Operator ${runId}`,
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
              name: `Consumption Audit Installation ${runId}`,
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

      // A second producer installation -- doubles as (a) the
      // installation a soon-to-be-REVOKED grant names, and (b) the
      // "wrong installation" target for a test that calls the RPC
      // against the FIRST (still-ACTIVE) grant while claiming this
      // installation instead of the one that grant actually names.
      const { data: revokedInstallation, error: revokedInstallationError } =
        await clientProducerOwner
          .from("installations")
          .insert(
            {
              operator_id: operatorId,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Consumption Audit Revoked-Grant Installation ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (revokedInstallationError || !revokedInstallation) {
        throw new Error(
          `Failed to create revoked-grant installation: ${revokedInstallationError?.message}`,
        );
      }

      revokedInstallationId = revokedInstallation.id;

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

      activeVerifiedEmissionDataId = emissionData.id;

      // Real INSERT + real accept UPDATE (producer owner / importer
      // member's own authenticated clients), exactly the two-step
      // shape sharing-grants-isolation.test.ts's own fixtures use --
      // this suite is testing the RPC's own re-verification, not the
      // grant lifecycle itself, but the grant must still be genuinely
      // ACTIVE via the real transitions for that re-verification to
      // mean anything.
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

      grantId = grant.id;

      const { error: acceptError } =
        await clientImporterMember
          .from("sharing_grants")
          .update(
            { status: "ACTIVE" },
          )
          .eq(
            "id",
            grantId,
          );

      if (acceptError) {
        throw new Error(
          `Failed to accept grant: ${acceptError.message}`,
        );
      }

      const { data: grant2, error: grant2Error } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: importerOrgId,
              installation_id: revokedInstallationId,
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

      revokedGrantId = grant2.id;

      const { error: accept2Error } =
        await clientImporterMember
          .from("sharing_grants")
          .update(
            { status: "ACTIVE" },
          )
          .eq(
            "id",
            revokedGrantId,
          );

      if (accept2Error) {
        throw new Error(
          `Failed to accept second grant: ${accept2Error.message}`,
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
          `Failed to revoke second grant: ${revokeError.message}`,
        );
      }

      // A real shipment + shipment_line under the IMPORTER org, via the
      // importer member's own authenticated client -- the "line that
      // recorded the determination" the RPC's own (d) check verifies
      // belongs to the grantee org. No real emission_determination is
      // written onto it (this suite tests the RPC directly, not
      // determineLineFromActualData's own wiring -- that is covered by
      // determine-from-actual-data.test.ts's mock-based unit tests).
      const { data: shipment, error: shipmentError } =
        await clientImporterMember
          .from("shipments")
          .insert(
            {
              org_id: importerOrgId,
              reference: `CONSUMPTION-AUDIT-${runId}`,
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

      shipmentId = shipment.id;

      const { data: line, error: lineError } =
        await clientImporterMember
          .from("shipment_lines")
          .insert(
            {
              shipment_id: shipmentId,
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

      lineId = line.id;
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
          [producerOrgId, importerOrgId, strangerOrgId],
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [producerOrgId, importerOrgId, strangerOrgId],
        );

      await serviceClient
        .from("organizations")
        .delete()
        .in(
          "id",
          [producerOrgId, importerOrgId, strangerOrgId],
        );

      for (
        const id of [
          producerOwnerId,
          importerOwnerId,
          importerMemberId,
          strangerOwnerId,
        ]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "a stranger org (no relationship to the grant at all) cannot call the RPC to inject an audit event into the grantor's stream",
      async () => {
        const { data: beforeCount } =
          await serviceClient
            .from("audit_events")
            .select("id")
            .eq(
              "org_id",
              producerOrgId,
            );

        const row =
          await callRpc(
            clientStrangerOwner,
            {
              p_sharing_grant_id: grantId,
              p_installation_id: installationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "NOT_A_MEMBER",
        );

        expect(row?.result_audit_event_id).toBeNull();

        const { data: afterCount } =
          await serviceClient
            .from("audit_events")
            .select("id")
            .eq(
              "org_id",
              producerOrgId,
            );

        expect(
          (afterCount ?? []).length,
        ).toBe(
          (beforeCount ?? []).length,
        );
      },
    );

    it(
      "a member of the actual grantee org cannot report a consumption event for a REVOKED grant",
      async () => {
        const row =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: revokedGrantId,
              p_installation_id: revokedInstallationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "GRANT_NOT_ACTIVE",
        );

        expect(row?.result_audit_event_id).toBeNull();
      },
    );

    it(
      "a DEACTIVATED member of the grantee org cannot report a consumption event, and can again once reactivated",
      async () => {
        // This RPC's NOT_A_MEMBER gate was a raw
        // `exists (select 1 from public.memberships ...)` until
        // 20260829360000 -- which counted a deactivated membership as
        // membership, so an offboarded person could keep writing
        // "your data was consumed" claims into the GRANTOR org's
        // append-only audit stream, which by design has no UPDATE or
        // DELETE policy and therefore no way to retract them. The gate
        // now routes through app.user_org_ids(), so this probes the
        // same helper the RLS policies use, from a code path that is
        // not an RLS policy at all.
        async function setImporterMemberDeactivatedAt(
          value: string | null,
        ): Promise<void> {
          const { error } =
            await serviceClient
              .from("memberships")
              .update(
                { deactivated_at: value },
              )
              .eq("org_id", importerOrgId)
              .eq("user_id", importerMemberId);

          expect(error).toBeNull();
        }

        await setImporterMemberDeactivatedAt(
          new Date().toISOString(),
        );

        try {
          const deactivatedRow =
            await callRpc(
              clientImporterMember,
              {
                p_sharing_grant_id: grantId,
                p_installation_id: installationId,
                p_emission_data_id: activeVerifiedEmissionDataId,
                p_emission_data_version: 1,
                p_shipment_line_id: lineId,
                p_determination_kind: "DETERMINED",
              },
            );

          expect(deactivatedRow?.result_status).toBe(
            "NOT_A_MEMBER",
          );

          expect(deactivatedRow?.result_audit_event_id).toBeNull();
        } finally {
          await setImporterMemberDeactivatedAt(
            null,
          );
        }

        // Reactivated, the identical call goes through -- so the
        // rejection above was the deactivation and nothing else about
        // these fixtures.
        const reactivatedRow =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: grantId,
              p_installation_id: installationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(reactivatedRow?.result_status).toBe(
          "OK",
        );

        expect(reactivatedRow?.result_audit_event_id).not.toBeNull();
      },
    );

    it(
      "a member of the actual grantee org cannot report a consumption event against the WRONG installation for an otherwise-ACTIVE grant",
      async () => {
        const row =
          await callRpc(
            clientImporterMember,
            {
              // grantId is real and ACTIVE, but it names `installationId`
              // -- not `revokedInstallationId`, which is what this call
              // claims.
              p_sharing_grant_id: grantId,
              p_installation_id: revokedInstallationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "INSTALLATION_MISMATCH",
        );

        expect(row?.result_audit_event_id).toBeNull();
      },
    );

    it(
      "rejects a mismatched emission_data id/version pair, and a shipment_line the caller's org doesn't own",
      async () => {
        const badVersionRow =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: grantId,
              p_installation_id: installationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 999,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(badVersionRow?.result_status).toBe(
          "EMISSION_DATA_MISMATCH",
        );

        const badLineRow =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: grantId,
              p_installation_id: installationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: crypto.randomUUID(),
              p_determination_kind: "DETERMINED",
            },
          );

        expect(badLineRow?.result_status).toBe(
          "SHIPMENT_LINE_NOT_FOUND",
        );
      },
    );

    it(
      "a legitimate call by the grantee org produces exactly one correctly-scoped audit_events row in the GRANTOR's org -- not the caller's own",
      async () => {
        const row =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: grantId,
              p_installation_id: installationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "OK",
        );

        expect(row?.result_audit_event_id).not.toBeNull();

        const { data: grantorRows } =
          await serviceClient
            .from("audit_events")
            .select(
              "id, org_id, actor_type, actor_user_id, event_type, aggregate_type, aggregate_id, payload",
            )
            .eq(
              "id",
              row!.result_audit_event_id!,
            );

        expect(grantorRows).toHaveLength(
          1,
        );

        const auditRow =
          grantorRows![0]!;

        expect(auditRow.org_id).toBe(
          producerOrgId,
        );

        expect(auditRow.org_id).not.toBe(
          importerOrgId,
        );

        expect(auditRow.actor_type).toBe(
          "USER",
        );

        expect(auditRow.actor_user_id).toBe(
          importerMemberId,
        );

        expect(auditRow.event_type).toBe(
          "sharing_grant.data_consumed",
        );

        expect(auditRow.aggregate_type).toBe(
          "SHARING_GRANT",
        );

        expect(auditRow.aggregate_id).toBe(
          grantId,
        );

        expect(auditRow.payload).toEqual(
          {
            installation_id: installationId,
            emission_data_id: activeVerifiedEmissionDataId,
            emission_data_version: 1,
            consuming_org_id: importerOrgId,
            shipment_line_id: lineId,
            determination_kind: "DETERMINED",
          },
        );

        // The caller (importer member) must never be able to read this
        // row back out of the GRANTOR's own audit stream --
        // audit_events_select_own_org (20260828070000) scopes SELECT to
        // `org_id in (select app.user_org_ids())`, and the importer
        // member is not a member of producerOrgId, so this must come
        // back empty even though the row genuinely exists.
        const { data: importerView } =
          await clientImporterMember
            .from("audit_events")
            .select("id")
            .eq(
              "id",
              row!.result_audit_event_id!,
            );

        expect(importerView).toEqual(
          [],
        );
      },
    );

    it(
      "reports GRANT_NOT_FOUND for a nonexistent grant id",
      async () => {
        const row =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: crypto.randomUUID(),
              p_installation_id: installationId,
              p_emission_data_id: activeVerifiedEmissionDataId,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "GRANT_NOT_FOUND",
        );
      },
    );

    it(
      "a member of the actual grantee org cannot report a consumption event for a grant that is ACTIVE but past its own expires_at (2026-08-29 review fix)",
      async () => {
        // expires_at is fact-immutable after INSERT
        // (app.prevent_sharing_grant_fact_change(), 20260829300000) --
        // only settable at creation, so a lapsed-but-ACTIVE grant is
        // built as its own fully self-contained fixture (a dedicated
        // installation + emission_data row, since the shared
        // installationId/activeVerifiedEmissionDataId fixtures already
        // have a live ACTIVE grant occupying
        // sharing_grants_installation_grantee_active_uq for that exact
        // (installation, grantee org) pair): a fresh grant with a past
        // expires_at, accepted through the real transition, exactly the
        // shape acceptSharingGrant's own CAS UPDATE expects. There is no
        // scheduled EXPIRE job in this codebase
        // (app.user_shared_installation_ids()'s own comment,
        // 20260829260000, is explicit about that), so this is a
        // genuinely reachable long-lived state, not a contrivance.
        const { data: expiredInstallation, error: expiredInstallationError } =
          await clientProducerOwner
            .from("installations")
            .insert(
              {
                operator_id: operatorId,
                org_id: producerOrgId,
                provenance: "OPERATOR_PROVIDED",
                name: `Consumption Audit Expired-Grant Installation ${runId}`,
                country: "DE",
              },
            )
            .select("id")
            .single();

        if (expiredInstallationError || !expiredInstallation) {
          throw new Error(
            `Failed to seed expired-grant installation: ${expiredInstallationError?.message}`,
          );
        }

        const { data: expiredEmissionData, error: expiredEmissionDataError } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: expiredInstallation.id,
                entered_by_org_id: producerOrgId,
                cn_scope: ["72081000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                direct_specific: "1.2",
                indirect_specific: "0.3",
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

        if (expiredEmissionDataError || !expiredEmissionData) {
          throw new Error(
            `Failed to seed emission_data for the expired-grant fixture: ${expiredEmissionDataError?.message}`,
          );
        }

        const { data: expiredGrant, error: expiredGrantError } =
          await clientProducerOwner
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                grantee_org_id: importerOrgId,
                installation_id: expiredInstallation.id,
                created_by_user_id: producerOwnerId,
                expires_at: "2020-01-01T00:00:00.000Z",
              },
            )
            .select("id")
            .single();

        if (expiredGrantError || !expiredGrant) {
          throw new Error(
            `Failed to seed an already-expired grant: ${expiredGrantError?.message}`,
          );
        }

        const { error: acceptExpiredError } =
          await clientImporterMember
            .from("sharing_grants")
            .update(
              { status: "ACTIVE" },
            )
            .eq(
              "id",
              expiredGrant.id,
            );

        if (acceptExpiredError) {
          throw new Error(
            `Failed to accept the expired-grant fixture: ${acceptExpiredError.message}`,
          );
        }

        const row =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: expiredGrant.id,
              p_installation_id: expiredInstallation.id,
              p_emission_data_id: expiredEmissionData.id,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "GRANT_NOT_ACTIVE",
        );

        expect(row?.result_audit_event_id).toBeNull();

        await serviceClient
          .from("sharing_grants")
          .delete()
          .eq(
            "id",
            expiredGrant.id,
          );

        await serviceClient
          .from("emission_data")
          .delete()
          .eq(
            "id",
            expiredEmissionData.id,
          );

        await serviceClient
          .from("installations")
          .delete()
          .eq(
            "id",
            expiredInstallation.id,
          );
      },
    );

    it(
      "a member of the actual grantee org cannot report a consumption event for an emission_data row they cannot actually read (DRAFT, unverified) (2026-08-29 review fix)",
      async () => {
        const { data: draftEmissionData, error: draftEmissionDataError } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: installationId,
                entered_by_org_id: producerOrgId,
                cn_scope: ["72081000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2027,
                direct_specific: "1.1",
                indirect_specific: "0.4",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                status: "DRAFT",
                verification_status: "UNVERIFIED",
                version: 1,
              },
            )
            .select("id")
            .single();

        if (draftEmissionDataError || !draftEmissionData) {
          throw new Error(
            `Failed to seed draft emission_data: ${draftEmissionDataError?.message}`,
          );
        }

        // Confirm the grantee genuinely cannot SELECT this row at all
        // -- the premise the RPC must not contradict.
        const { data: granteeView } =
          await clientImporterMember
            .from("emission_data")
            .select("id")
            .eq(
              "id",
              draftEmissionData.id,
            );

        expect(granteeView).toEqual(
          [],
        );

        const row =
          await callRpc(
            clientImporterMember,
            {
              p_sharing_grant_id: grantId,
              p_installation_id: installationId,
              p_emission_data_id: draftEmissionData.id,
              p_emission_data_version: 1,
              p_shipment_line_id: lineId,
              p_determination_kind: "DETERMINED",
            },
          );

        expect(row?.result_status).toBe(
          "EMISSION_DATA_MISMATCH",
        );

        expect(row?.result_audit_event_id).toBeNull();

        await serviceClient
          .from("emission_data")
          .delete()
          .eq(
            "id",
            draftEmissionData.id,
          );
      },
    );
  },
);
