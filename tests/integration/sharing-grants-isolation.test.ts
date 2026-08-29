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

// Standing three-party isolation suite for P7-D's cross-organization
// sharing (sharing_grants + the installations/emission_data SELECT RLS
// extensions in 20260829260000_p7d_sharing_grants_schema.sql), extending
// the same pattern as tests/integration/organizations-isolation.test.ts
// (local-only-instance rationale, fixed local demo JWTs -- not secrets,
// skip-not-fail discipline) and tests/integration/shipments-isolation.test.ts
// (the two-org shape this file extends to three parties: producer/
// grantor, importer/grantee, and a stranger org with no relationship to
// either).
//
// This suite codifies behaviors verified manually, live, during P7-D's
// independent post-build review before that migration was trusted enough
// to commit -- including one real gap found during that review (a grant
// past its own expires_at kept conferring read access indefinitely,
// since nothing in this codebase runs the EXPIRE transition
// automatically) and fixed in the same not-yet-committed migration. That
// review was ad hoc (hand-written psql, not committed anywhere) -- this
// file turns it into permanent regression coverage, the same reasoning
// shipments-isolation.test.ts's own header comment gives for why manual
// verification alone isn't enough to leave trusted forever.

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
  "sharing_grants cross-org RLS (local Supabase only)",
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
    let invitedOrgId: string;

    let producerOwnerId: string;
    let producerMemberId: string;
    let importerOwnerId: string;
    let importerMemberId: string;
    let strangerOwnerId: string;
    let invitedOwnerId: string;

    let clientProducerOwner: SupabaseClient;
    let clientProducerMember: SupabaseClient;
    let clientImporterOwner: SupabaseClient;
    let clientImporterMember: SupabaseClient;
    let clientStrangerOwner: SupabaseClient;
    let clientInvitedOwner: SupabaseClient;

    let operatorId: string;
    let installationId: string;
    let activeVerifiedEmissionDataId: string;
    let grantId: string;
    let expiredGrantInstallationId: string;

    // P7-D2 (20260829300000) bootstrap-by-email fixtures.
    let invitedUserEmail: string;
    let bootstrapInstallationId: string;
    let bootstrapGrantId: string;
    let revokedBootstrapGrantId: string;
    let selfGrantBootstrapGrantId: string;

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
              name: `Sharing Isolation Producer ${runId}`,
              slug: `sharing-isolation-producer-${runId}`,
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
              name: `Sharing Isolation Importer ${runId}`,
              slug: `sharing-isolation-importer-${runId}`,
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
              name: `Sharing Isolation Stranger ${runId}`,
              slug: `sharing-isolation-stranger-${runId}`,
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

      // A fourth org for the bootstrap-by-email accept path (P7-D2,
      // 20260829300000) -- distinct from importerOrg (which already
      // holds an ACTIVE direct grant used by the tests above) so
      // accepting a bootstrap invite into this org doesn't interact with
      // that fixture.
      const { data: invitedOrg, error: invitedOrgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Sharing Isolation Invited ${runId}`,
              slug: `sharing-isolation-invited-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (invitedOrgError || !invitedOrg) {
        throw new Error(
          `Failed to create invited org: ${invitedOrgError?.message}`,
        );
      }

      invitedOrgId = invitedOrg.id;

      const password =
        `sharing-isolation-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `sharing-isolation-${label}-${runId}@example.com`,
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
      producerMemberId = await createUser("producer-member");
      importerOwnerId = await createUser("importer-owner");
      importerMemberId = await createUser("importer-member");
      strangerOwnerId = await createUser("stranger-owner");
      invitedOwnerId = await createUser("invited-owner");

      invitedUserEmail =
        `sharing-isolation-invited-owner-${runId}@example.com`;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: producerOrgId, user_id: producerOwnerId, role: "OWNER" },
              { org_id: producerOrgId, user_id: producerMemberId, role: "MEMBER" },
              { org_id: importerOrgId, user_id: importerOwnerId, role: "OWNER" },
              { org_id: importerOrgId, user_id: importerMemberId, role: "MEMBER" },
              { org_id: strangerOrgId, user_id: strangerOwnerId, role: "OWNER" },
              { org_id: invitedOrgId, user_id: invitedOwnerId, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientProducerOwner =
        await signInAnonClient(
          `sharing-isolation-producer-owner-${runId}@example.com`,
          password,
        );

      clientProducerMember =
        await signInAnonClient(
          `sharing-isolation-producer-member-${runId}@example.com`,
          password,
        );

      clientImporterOwner =
        await signInAnonClient(
          `sharing-isolation-importer-owner-${runId}@example.com`,
          password,
        );

      clientImporterMember =
        await signInAnonClient(
          `sharing-isolation-importer-member-${runId}@example.com`,
          password,
        );

      clientStrangerOwner =
        await signInAnonClient(
          `sharing-isolation-stranger-owner-${runId}@example.com`,
          password,
        );

      clientInvitedOwner =
        await signInAnonClient(
          invitedUserEmail,
          password,
        );

      const { data: operator, error: operatorError } =
        await clientProducerOwner
          .from("operators")
          .insert(
            {
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Sharing Isolation Operator ${runId}`,
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

      operatorId =
        operator.id;

      const { data: installation, error: installationError } =
        await clientProducerOwner
          .from("installations")
          .insert(
            {
              operator_id: operator.id,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Sharing Isolation Installation ${runId}`,
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

      // Seven emission_data rows spanning every (status, verification_status)
      // combination -- inserted via the service client with explicit
      // status/verification_status values, bypassing the ordinary
      // record->submit->verify lifecycle (already covered by
      // manage-emission-data.test.ts) since this suite is testing the
      // READ boundary, not the lifecycle transitions. The fact-change and
      // verification-gate triggers are BEFORE UPDATE only, so a direct
      // INSERT with arbitrary status/verification_status is unaffected by
      // either.
      const emissionDataFixtures =
        [
          { status: "DRAFT", verification_status: "UNVERIFIED", direct_specific: "1.0" },
          { status: "DRAFT", verification_status: "VERIFICATION_PENDING", direct_specific: "1.1" },
          { status: "DRAFT", verification_status: "VERIFIED", direct_specific: "1.2" },
          { status: "ACTIVE", verification_status: "VERIFIED", direct_specific: "1.3" },
          { status: "DRAFT", verification_status: "REJECTED", direct_specific: "1.4" },
          { status: "SUPERSEDED", verification_status: "VERIFIED", direct_specific: "1.5" },
          { status: "DISCARDED", verification_status: "UNVERIFIED", direct_specific: "1.6" },
        ] as const;

      for (const [index, fixture] of emissionDataFixtures.entries()) {
        const { data, error } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: installationId,
                entered_by_org_id: producerOrgId,
                cn_scope: ["72081000"],
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2026,
                direct_specific: fixture.direct_specific,
                indirect_specific: "0.5",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                status: fixture.status,
                verification_status: fixture.verification_status,
                verifier_user_id:
                  fixture.verification_status === "VERIFIED" ? producerOwnerId : null,
                // All 7 fixtures share the same installation+period
                // lineage on purpose (this suite is testing the read
                // boundary by status/verification_status, not distinct
                // periods) -- explicit, distinct version numbers avoid
                // colliding with emission_data_version_uq
                // (20260829290000), which -- correctly -- no longer
                // allows two rows in the same lineage to share a
                // version number.
                version: index + 1,
              },
            )
            .select("id")
            .single();

        if (error || !data) {
          throw new Error(
            `Failed to seed emission_data (${fixture.status}/${fixture.verification_status}): ${error?.message}`,
          );
        }

        if (fixture.status === "ACTIVE" && fixture.verification_status === "VERIFIED") {
          activeVerifiedEmissionDataId = data.id;
        }
      }

      // Real INSERT via the producer OWNER's own authenticated client --
      // exercises sharing_grants_insert_own_org directly, not a
      // service-role bypass.
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

      // Real UPDATE via a plain (non-admin) importer MEMBER -- exercises
      // sharing_grants_update_grantee_accept directly, and doubles as
      // proof that accept is not ADMIN+-restricted.
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

      // A second installation with an ACTIVE grant that has already
      // expired -- the expiry gap found and fixed during P7-D's
      // independent review (app.user_shared_installation_ids() must
      // check expires_at, not just status).
      const { data: expiredInstallation, error: expiredInstallationError } =
        await clientProducerOwner
          .from("installations")
          .insert(
            {
              operator_id: operator.id,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Sharing Isolation Expired-Grant Installation ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (expiredInstallationError || !expiredInstallation) {
        throw new Error(
          `Failed to create expired-grant installation: ${expiredInstallationError?.message}`,
        );
      }

      expiredGrantInstallationId = expiredInstallation.id;

      const pastExpiry =
        new Date(
          Date.now() - 60 * 60 * 1000,
        ).toISOString();

      const { data: expiredGrant, error: expiredGrantError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: importerOrgId,
              installation_id: expiredGrantInstallationId,
              expires_at: pastExpiry,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (expiredGrantError || !expiredGrant) {
        throw new Error(
          `Failed to issue expiring grant: ${expiredGrantError?.message}`,
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
          `Failed to accept expiring grant: ${acceptExpiredError.message}`,
        );
      }

      // ------------------------------------------------------------
      // P7-D2 (20260829300000) bootstrap-by-email fixtures -- a real
      // INSERT via the producer OWNER's own authenticated client
      // (exercises sharing_grants_insert_own_org's bootstrap branch
      // directly, same as the direct-grant INSERT above), grantee_org_id
      // omitted, invited_email set instead.
      // ------------------------------------------------------------

      const { data: bootstrapInstallation, error: bootstrapInstallationError } =
        await clientProducerOwner
          .from("installations")
          .insert(
            {
              operator_id: operatorId,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `Sharing Isolation Bootstrap Installation ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (bootstrapInstallationError || !bootstrapInstallation) {
        throw new Error(
          `Failed to create bootstrap installation: ${bootstrapInstallationError?.message}`,
        );
      }

      bootstrapInstallationId = bootstrapInstallation.id;

      const { data: bootstrapGrant, error: bootstrapGrantError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              invited_email: invitedUserEmail,
              installation_id: bootstrapInstallationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (bootstrapGrantError || !bootstrapGrant) {
        throw new Error(
          `Failed to issue bootstrap grant: ${bootstrapGrantError?.message}`,
        );
      }

      bootstrapGrantId = bootstrapGrant.id;

      // A second bootstrap invite, revoked before acceptance -- for the
      // "a REVOKED invite cannot be accepted" case.
      const { data: revokedBootstrapGrant, error: revokedBootstrapGrantError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              invited_email: invitedUserEmail,
              installation_id: bootstrapInstallationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (revokedBootstrapGrantError || !revokedBootstrapGrant) {
        throw new Error(
          `Failed to issue revoked bootstrap grant: ${revokedBootstrapGrantError?.message}`,
        );
      }

      revokedBootstrapGrantId = revokedBootstrapGrant.id;

      const { error: revokeBootstrapError } =
        await clientProducerOwner
          .from("sharing_grants")
          .update(
            { status: "REVOKED" },
          )
          .eq(
            "id",
            revokedBootstrapGrantId,
          );

      if (revokeBootstrapError) {
        throw new Error(
          `Failed to revoke bootstrap grant: ${revokeBootstrapError.message}`,
        );
      }

      // A third bootstrap invite, addressed to the PRODUCER owner's own
      // email -- for the SELF_GRANT_NOT_ALLOWED case (accepting into the
      // grantor's own org).
      const { data: selfGrantBootstrapGrant, error: selfGrantBootstrapGrantError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              invited_email: `sharing-isolation-producer-owner-${runId}@example.com`,
              installation_id: bootstrapInstallationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (selfGrantBootstrapGrantError || !selfGrantBootstrapGrant) {
        throw new Error(
          `Failed to issue self-grant bootstrap grant: ${selfGrantBootstrapGrantError?.message}`,
        );
      }

      selfGrantBootstrapGrantId = selfGrantBootstrapGrant.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("sharing_grants")
        .delete()
        .in(
          "grantor_org_id",
          [producerOrgId],
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
          [producerOrgId, importerOrgId, strangerOrgId, invitedOrgId],
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [producerOrgId, importerOrgId, strangerOrgId, invitedOrgId],
        );

      await serviceClient
        .from("organizations")
        .delete()
        .in(
          "id",
          [producerOrgId, importerOrgId, strangerOrgId, invitedOrgId],
        );

      for (
        const id of [
          producerOwnerId,
          producerMemberId,
          importerOwnerId,
          importerMemberId,
          strangerOwnerId,
          invitedOwnerId,
        ]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "a stranger org sees neither the installation nor any of its emission_data",
      async () => {
        const { data: installations } =
          await clientStrangerOwner
            .from("installations")
            .select("id")
            .eq(
              "id",
              installationId,
            );

        expect(installations).toEqual(
          [],
        );

        const { data: emissionData } =
          await clientStrangerOwner
            .from("emission_data")
            .select("id")
            .eq(
              "installation_id",
              installationId,
            );

        expect(emissionData).toEqual(
          [],
        );
      },
    );

    it(
      "the active grantee sees the installation and EXACTLY the one ACTIVE+VERIFIED emission_data row",
      async () => {
        const { data: installations } =
          await clientImporterMember
            .from("installations")
            .select("id")
            .eq(
              "id",
              installationId,
            );

        expect(installations).toEqual(
          [
            { id: installationId },
          ],
        );

        const { data: emissionData } =
          await clientImporterMember
            .from("emission_data")
            .select(
              "id, status, verification_status",
            )
            .eq(
              "installation_id",
              installationId,
            );

        expect(emissionData).toEqual(
          [
            {
              id: activeVerifiedEmissionDataId,
              status: "ACTIVE",
              verification_status: "VERIFIED",
            },
          ],
        );
      },
    );

    it(
      "the grantee cannot write to the shared installation or its emission_data",
      async () => {
        const { data: installationUpdate } =
          await clientImporterMember
            .from("installations")
            .update(
              { name: "Tampered" },
            )
            .eq(
              "id",
              installationId,
            )
            .select(
              "id",
            );

        expect(
          installationUpdate ?? [],
        ).toEqual(
          [],
        );

        const { data: emissionDataUpdate } =
          await clientImporterMember
            .from("emission_data")
            .update(
              { direct_specific: "999" },
            )
            .eq(
              "id",
              activeVerifiedEmissionDataId,
            )
            .select(
              "id",
            );

        expect(
          emissionDataUpdate ?? [],
        ).toEqual(
          [],
        );

        // Uses the GRANTOR's real operatorId (not a bogus/nonexistent
        // one) -- an invalid FK would fail before RLS is ever consulted
        // and would prove nothing about the write boundary this test
        // exists to check (found and fixed during P7's mandatory
        // cross-organization-sharing review). This must be denied by
        // installations_insert_own_org's own EXISTS clause
        // (20260829220000: operator_id's own org_id must match the
        // INSERT's org_id), not by a foreign-key violation.
        const { error: insertError } =
          await clientImporterMember
            .from("installations")
            .insert(
              {
                operator_id: operatorId,
                org_id: importerOrgId,
                provenance: "IMPORTER_ENTERED",
                name: "Should never be allowed",
                country: "DE",
              },
            );

        expect(insertError).not.toBeNull();

        expect(insertError?.message).not.toContain(
          "foreign key",
        );
      },
    );

    it(
      "a plain MEMBER of the grantor org cannot issue a grant",
      async () => {
        const { error } =
          await clientProducerMember
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                grantee_org_id: strangerOrgId,
                installation_id: installationId,
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a grant whose expires_at has already passed confers no read access, even while status reads ACTIVE",
      async () => {
        const { data: grant } =
          await clientProducerOwner
            .from("sharing_grants")
            .select(
              "status",
            )
            .eq(
              "installation_id",
              expiredGrantInstallationId,
            )
            .single();

        expect(grant?.status).toBe(
          "ACTIVE",
        );

        const { data: installations } =
          await clientImporterMember
            .from("installations")
            .select("id")
            .eq(
              "id",
              expiredGrantInstallationId,
            );

        expect(installations).toEqual(
          [],
        );
      },
    );

    it(
      "revoking the grant ends the grantee's read access; the producer's own org is unaffected",
      async () => {
        const { error: revokeError } =
          await clientProducerOwner
            .from("sharing_grants")
            .update(
              { status: "REVOKED" },
            )
            .eq(
              "id",
              grantId,
            );

        expect(revokeError).toBeNull();

        const { data: postRevokeInstallations } =
          await clientImporterMember
            .from("installations")
            .select("id")
            .eq(
              "id",
              installationId,
            );

        expect(postRevokeInstallations).toEqual(
          [],
        );

        const { data: postRevokeEmissionData } =
          await clientImporterMember
            .from("emission_data")
            .select("id")
            .eq(
              "installation_id",
              installationId,
            );

        expect(postRevokeEmissionData).toEqual(
          [],
        );

        const { data: producerOwnRows } =
          await clientProducerOwner
            .from("emission_data")
            .select("id")
            .eq(
              "installation_id",
              installationId,
            );

        expect(
          (producerOwnRows ?? []).length,
        ).toBe(
          7,
        );
      },
    );

    // ------------------------------------------------------------
    // P7-D2 (20260829300000): bootstrap-by-email accept path --
    // accept_sharing_grant_invitation() and its three new pending-
    // invitation SELECT policies.
    // ------------------------------------------------------------

    it(
      "the invited user (matching email) sees the pending bootstrap grant, the grantor org's name, and the installation's name; a stranger sees none of it",
      async () => {
        const { data: invitedSeesGrant } =
          await clientInvitedOwner
            .from("sharing_grants")
            .select("id, status, invited_email")
            .eq(
              "id",
              bootstrapGrantId,
            );

        expect(invitedSeesGrant).toEqual(
          [
            { id: bootstrapGrantId, status: "INVITED", invited_email: invitedUserEmail },
          ],
        );

        const { data: invitedSeesOrg } =
          await clientInvitedOwner
            .from("organizations")
            .select("id")
            .eq(
              "id",
              producerOrgId,
            );

        expect(invitedSeesOrg).toEqual(
          [
            { id: producerOrgId },
          ],
        );

        const { data: invitedSeesInstallation } =
          await clientInvitedOwner
            .from("installations")
            .select("id")
            .eq(
              "id",
              bootstrapInstallationId,
            );

        expect(invitedSeesInstallation).toEqual(
          [
            { id: bootstrapInstallationId },
          ],
        );

        const { data: strangerSeesGrant } =
          await clientStrangerOwner
            .from("sharing_grants")
            .select("id")
            .eq(
              "id",
              bootstrapGrantId,
            );

        expect(strangerSeesGrant).toEqual(
          [],
        );

        const { data: strangerSeesOrg } =
          await clientStrangerOwner
            .from("organizations")
            .select("id")
            .eq(
              "id",
              producerOrgId,
            );

        expect(strangerSeesOrg).toEqual(
          [],
        );

        const { data: strangerSeesInstallation } =
          await clientStrangerOwner
            .from("installations")
            .select("id")
            .eq(
              "id",
              bootstrapInstallationId,
            );

        expect(strangerSeesInstallation).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger whose authenticated email does not match invited_email cannot accept, regardless of which org id they pass",
      async () => {
        const { data } =
          await clientStrangerOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: bootstrapGrantId,
              p_org_id: strangerOrgId,
            },
          );

        const row =
          (data as { result_status: string; result_org_id: string | null }[] | null)?.[0];

        expect(row?.result_status).toBe(
          "EMAIL_MISMATCH",
        );

        const { data: stillInvited } =
          await serviceClient
            .from("sharing_grants")
            .select("status, grantee_org_id")
            .eq(
              "id",
              bootstrapGrantId,
            )
            .single();

        expect(stillInvited).toEqual(
          { status: "INVITED", grantee_org_id: null },
        );
      },
    );

    it(
      "the invited user cannot accept into an org they are not a member of, even though their email matches",
      async () => {
        const { data } =
          await clientInvitedOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: bootstrapGrantId,
              p_org_id: strangerOrgId,
            },
          );

        const row =
          (data as { result_status: string; result_org_id: string | null }[] | null)?.[0];

        expect(row?.result_status).toBe(
          "NOT_A_MEMBER",
        );

        const { data: stillInvited } =
          await serviceClient
            .from("sharing_grants")
            .select("status, grantee_org_id")
            .eq(
              "id",
              bootstrapGrantId,
            )
            .single();

        expect(stillInvited).toEqual(
          { status: "INVITED", grantee_org_id: null },
        );
      },
    );

    it(
      "the grantor cannot accept their own invitation into their own org",
      async () => {
        const { data } =
          await clientProducerOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: selfGrantBootstrapGrantId,
              p_org_id: producerOrgId,
            },
          );

        const row =
          (data as { result_status: string; result_org_id: string | null }[] | null)?.[0];

        expect(row?.result_status).toBe(
          "SELF_GRANT_NOT_ALLOWED",
        );
      },
    );

    it(
      "a REVOKED bootstrap invite cannot be accepted",
      async () => {
        const { data } =
          await clientInvitedOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: revokedBootstrapGrantId,
              p_org_id: invitedOrgId,
            },
          );

        const row =
          (data as { result_status: string; result_org_id: string | null }[] | null)?.[0];

        expect(row?.result_status).toBe(
          "NOT_PENDING",
        );
      },
    );

    it(
      "the correctly invited user accepts into their own active org, resolving grantee_org_id and granting the same read access a direct grant would", async () => {
        const { data: acceptData } =
          await clientInvitedOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: bootstrapGrantId,
              p_org_id: invitedOrgId,
            },
          );

        const acceptRow =
          (acceptData as { result_status: string; result_org_id: string | null }[] | null)?.[0];

        expect(acceptRow).toEqual(
          { result_status: "OK", result_org_id: invitedOrgId },
        );

        const { data: resolvedGrant } =
          await serviceClient
            .from("sharing_grants")
            .select("status, grantee_org_id, invited_email")
            .eq(
              "id",
              bootstrapGrantId,
            )
            .single();

        expect(resolvedGrant).toEqual(
          { status: "ACTIVE", grantee_org_id: invitedOrgId, invited_email: invitedUserEmail },
        );

        // The now-resolved grantee org reads the shared installation the
        // same way the direct-grant tests above already prove for
        // importerOrgId -- app.user_shared_installation_ids() does not
        // distinguish how grantee_org_id was resolved.
        const { data: installationsAfterAccept } =
          await clientInvitedOwner
            .from("installations")
            .select("id")
            .eq(
              "id",
              bootstrapInstallationId,
            );

        expect(installationsAfterAccept).toEqual(
          [
            { id: bootstrapInstallationId },
          ],
        );

        // Re-accepting the now-ACTIVE grant is rejected, not a silent OK
        // (same CAS discipline as acceptSharingGrant's own
        // GRANT_NOT_INVITED case in manage-sharing-grants.ts).
        const { data: reacceptData } =
          await clientInvitedOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: bootstrapGrantId,
              p_org_id: invitedOrgId,
            },
          );

        const reacceptRow =
          (reacceptData as { result_status: string; result_org_id: string | null }[] | null)?.[0];

        expect(reacceptRow?.result_status).toBe(
          "ALREADY_ACTIVE",
        );
      },
    );

    it(
      "rejects a bare client UPDATE that tries to resolve a bootstrap grant's grantee_org_id without going through accept_sharing_grant_invitation() -- the exact bypass the mandatory review found (BLOCKING) and this migration was fixed to close",
      async () => {
        // Make the producer owner ALSO a plain member of an unrelated
        // org (strangerOrgId) -- the exploit's precondition ("an
        // ordinary consultant-in-two-orgs setup", per the review). A
        // direct service-role insert is the fixture-setup shape this
        // whole file already uses; it is not itself part of what's
        // being tested.
        const { error: extraMembershipError } =
          await serviceClient
            .from("memberships")
            .insert(
              { org_id: strangerOrgId, user_id: producerOwnerId, role: "MEMBER" },
            );

        if (extraMembershipError) {
          throw new Error(
            `Failed to seed producer owner's second membership: ${extraMembershipError.message}`,
          );
        }

        // A fresh bootstrap grant to attack -- reusing bootstrapGrantId
        // would conflate this test with the already-accepted state
        // asserted above.
        const { data: targetGrant, error: targetGrantError } =
          await clientProducerOwner
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                invited_email: `sharing-isolation-bypass-victim-${runId}@example.com`,
                installation_id: bootstrapInstallationId,
                created_by_user_id: producerOwnerId,
              },
            )
            .select("id")
            .single();

        if (targetGrantError || !targetGrant) {
          throw new Error(
            `Failed to issue the target bootstrap grant: ${targetGrantError?.message}`,
          );
        }

        // Variant 1 (forged acceptance): the producer owner, using the
        // revoke policy's own USING clause (admin of the grantor org,
        // row not yet terminal) to reach the row, tries to smuggle an
        // accept-shaped UPDATE past the OR-combined WITH CHECK by
        // choosing a grantee_org_id they belong to.
        const { error: forgedAcceptError } =
          await clientProducerOwner
            .from("sharing_grants")
            .update(
              { status: "ACTIVE", grantee_org_id: strangerOrgId },
            )
            .eq(
              "id",
              targetGrant.id,
            );

        expect(forgedAcceptError).not.toBeNull();

        // Variant 2 (arbitrary-org row injection): same actor, same
        // row, but landing on REVOKED -- the revoke policy's own WITH
        // CHECK never constrained grantee_org_id at all.
        const { error: injectionError } =
          await clientProducerOwner
            .from("sharing_grants")
            .update(
              { status: "REVOKED", grantee_org_id: strangerOrgId },
            )
            .eq(
              "id",
              targetGrant.id,
            );

        expect(injectionError).not.toBeNull();

        // Prove it via the service-role client too, not just "an error
        // was returned" -- the row must be completely untouched: still
        // INVITED, still no grantee, no accept ever recorded.
        const { data: untouchedRow } =
          await serviceClient
            .from("sharing_grants")
            .select("status, grantee_org_id")
            .eq("id", targetGrant.id)
            .single();

        expect(untouchedRow).toEqual(
          { status: "INVITED", grantee_org_id: null },
        );

        // Column-tampering the SAME row via the trigger's other guards
        // (unrelated to this bug, but this is the only test that builds
        // a disposable bootstrap row -- cheap to also lock in here)
        // still raises, confirming the security fix didn't loosen
        // anything else on this path.
        const { error: tamperError } =
          await clientProducerOwner
            .from("sharing_grants")
            .update(
              { invited_email: "someone-else@example.com" },
            )
            .eq(
              "id",
              targetGrant.id,
            );

        expect(tamperError).not.toBeNull();

        await serviceClient
          .from("memberships")
          .delete()
          .match(
            { org_id: strangerOrgId, user_id: producerOwnerId },
          );

        await serviceClient
          .from("sharing_grants")
          .delete()
          .eq(
            "id",
            targetGrant.id,
          );
      },
    );
  },
);
