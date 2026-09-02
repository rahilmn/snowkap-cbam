import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

/**
 * public.sharing_counterparty_org_names() -- disclosure rules, against
 * real local Postgres with real RLS and real acceptance.
 *
 * WHY THIS FILE EXISTS. 20260902150000 widens that function so a frozen
 * ACTUAL determination keeps naming the producer it came from after the
 * sharing grant is revoked -- reproduced in production on 2026-09-02,
 * where revoking grant 942ba281 turned an already-calculated 2 tCO2e
 * line's provenance into "Shared by Unknown organization". Widening a
 * SECURITY DEFINER cross-org disclosure is exactly the kind of change
 * that must be pinned by tests that could actually catch it going wrong,
 * so the asymmetry it introduces is asserted here in both directions,
 * including the cases that must stay CLOSED.
 *
 * The accepted-bootstrap fixture is produced by genuinely calling
 * public.accept_sharing_grant_invitation() as the invited, confirmed
 * user. It is deliberately NOT minted with a service-role insert: the
 * whole security argument for direction 2 is that the shape
 * (invited_email set AND grantee_org_id set) can only arise from real
 * acceptance, so a fixture that fabricates the shape would make these
 * tests pass vacuously and prove nothing.
 *
 * Sibling of shared-data-status-visibility.test.ts, which covers the
 * RLS policy on `organizations` itself. That policy is deliberately
 * unchanged by 20260902150000 and its assertions there stand as written.
 */

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

interface CounterpartyRow {
  id: string;
  name: string;
}

describe.skipIf(!localSupabaseReachable)(
  "sharing_counterparty_org_names (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(
        0,
        8,
      );

    const password =
      `counterparty-password-${runId}!`;

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );

    const createdOrgIds: string[] =
      [];

    const createdUserIds: string[] =
      [];

    let producerOrgId: string;
    let importerOrgId: string;
    let victimOrgId: string;
    let strangerOrgId: string;

    let producerOwnerId: string;
    let importerOwnerId: string;
    let strangerOwnerId: string;

    let clientProducerOwner: SupabaseClient;
    let clientImporterOwner: SupabaseClient;
    let clientStrangerOwner: SupabaseClient;

    let installationId: string;
    let secondInstallationId: string;
    let thirdInstallationId: string;
    let fourthInstallationId: string;

    let acceptedThenRevokedGrantId: string;
    let directRevokedGrantId: string;

    async function createOrg(
      label: string,
      capabilities: string[],
    ): Promise<string> {
      const { data, error } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Counterparty ${label} ${runId}`,
              slug: `counterparty-${label}-${runId}`,
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

      createdOrgIds.push(
        data.id,
      );

      return data.id;
    }

    async function createUser(
      label: string,
    ): Promise<string> {
      const { data, error } =
        await serviceClient.auth.admin.createUser(
          {
            email: `counterparty-${label}-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (error || !data.user) {
        throw new Error(
          `Failed to create ${label}: ${error?.message}`,
        );
      }

      createdUserIds.push(
        data.user.id,
      );

      return data.user.id;
    }

    async function addMembership(
      orgId: string,
      userId: string,
      role: string,
    ): Promise<void> {
      const { error } =
        await serviceClient
          .from("memberships")
          .insert(
            {
              org_id: orgId,
              user_id: userId,
              role,
            },
          );

      if (error) {
        throw new Error(
          `Failed to add membership: ${error.message}`,
        );
      }
    }

    async function signIn(
      label: string,
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
            email: `counterparty-${label}-${runId}@example.com`,
            password,
          },
        );

      if (error) {
        throw new Error(
          `Failed to sign in ${label}: ${error.message}`,
        );
      }

      return client;
    }

    async function createInstallation(
      orgId: string,
      operatorId: string,
      label: string,
    ): Promise<string> {
      const { data, error } =
        await serviceClient
          .from("installations")
          .insert(
            {
              org_id: orgId,
              operator_id: operatorId,
              name: `Counterparty ${label} ${runId}`,
              country: "IN",
              provenance: "OPERATOR_PROVIDED",
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to create installation ${label}: ${error?.message}`,
        );
      }

      return data.id;
    }

    async function counterpartyNames(
      client: SupabaseClient,
    ): Promise<CounterpartyRow[]> {
      const { data, error } =
        await client.rpc(
          "sharing_counterparty_org_names",
        );

      expect(error).toBeNull();

      return (data ?? []) as CounterpartyRow[];
    }

    beforeAll(async () => {
      producerOrgId = await createOrg("producer", ["PRODUCER_OPERATOR"]);
      importerOrgId = await createOrg("importer", ["IMPORTER_DECLARANT"]);
      victimOrgId = await createOrg("victim", ["IMPORTER_DECLARANT"]);
      strangerOrgId = await createOrg("stranger", ["IMPORTER_DECLARANT"]);

      producerOwnerId = await createUser("producer-owner");
      importerOwnerId = await createUser("importer-owner");
      strangerOwnerId = await createUser("stranger-owner");

      await addMembership(producerOrgId, producerOwnerId, "OWNER");
      await addMembership(importerOrgId, importerOwnerId, "OWNER");
      await addMembership(strangerOrgId, strangerOwnerId, "OWNER");

      clientProducerOwner = await signIn("producer-owner");
      clientImporterOwner = await signIn("importer-owner");
      clientStrangerOwner = await signIn("stranger-owner");

      const { data: operator, error: operatorError } =
        await serviceClient
          .from("operators")
          .insert(
            {
              org_id: producerOrgId,
              name: `Counterparty Operator ${runId}`,
              country: "IN",
              provenance: "OPERATOR_PROVIDED",
            },
          )
          .select("id")
          .single();

      if (operatorError || !operator) {
        throw new Error(
          `Failed to create operator: ${operatorError?.message}`,
        );
      }

      installationId = await createInstallation(producerOrgId, operator.id, "plant-a");
      secondInstallationId = await createInstallation(producerOrgId, operator.id, "plant-b");
      thirdInstallationId = await createInstallation(producerOrgId, operator.id, "plant-c");
      fourthInstallationId = await createInstallation(producerOrgId, operator.id, "plant-d");

      // --- Fixture 1: a GENUINELY ACCEPTED bootstrap grant, then revoked.
      //
      // Issued by email (grantee_org_id NULL), accepted through the real
      // RPC by the invited user, then revoked by the grantor. Nothing
      // here fabricates the accepted shape.
      const { data: bootstrapGrant, error: bootstrapError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              invited_email: `counterparty-importer-owner-${runId}@example.com`,
              installation_id: installationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (bootstrapError || !bootstrapGrant) {
        throw new Error(
          `Failed to issue bootstrap grant: ${bootstrapError?.message}`,
        );
      }

      acceptedThenRevokedGrantId = bootstrapGrant.id;

      const { data: acceptResult, error: acceptError } =
        await clientImporterOwner.rpc(
          "accept_sharing_grant_invitation",
          {
            p_grant_id: acceptedThenRevokedGrantId,
            p_org_id: importerOrgId,
          },
        );

      if (acceptError) {
        throw new Error(
          `Failed to accept bootstrap grant: ${acceptError.message}`,
        );
      }

      const acceptRow =
        (acceptResult as { result_status: string }[] | null)?.[0];

      if (acceptRow?.result_status !== "OK") {
        throw new Error(
          `Bootstrap acceptance did not return OK: ${acceptRow?.result_status}`,
        );
      }

      const { error: revokeBootstrapError } =
        await clientProducerOwner
          .from("sharing_grants")
          .update(
            { status: "REVOKED" },
          )
          .eq(
            "id",
            acceptedThenRevokedGrantId,
          );

      if (revokeBootstrapError) {
        throw new Error(
          `Failed to revoke bootstrap grant: ${revokeBootstrapError.message}`,
        );
      }

      // --- Fixture 2: the sham shape -- a DIRECT grant naming a victim
      // org that never accepted anything, revoked by its own issuer.
      const { data: directGrant, error: directError } =
        await clientProducerOwner
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: victimOrgId,
              installation_id: secondInstallationId,
              created_by_user_id: producerOwnerId,
            },
          )
          .select("id")
          .single();

      if (directError || !directGrant) {
        throw new Error(
          `Failed to issue direct grant: ${directError?.message}`,
        );
      }

      directRevokedGrantId = directGrant.id;
    });

    afterAll(async () => {
      for (const orgId of createdOrgIds) {
        await serviceClient
          .from("audit_events")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("organizations")
          .delete()
          .eq("id", orgId);
      }

      for (const userId of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "lets a GRANTEE resolve its GRANTOR name after the grant is REVOKED -- the frozen determination outlives the grant, so its provenance label must too",
      async () => {
        const rows =
          await counterpartyNames(
            clientImporterOwner,
          );

        expect(
          rows.map((row) => row.id),
        ).toContain(
          producerOrgId,
        );

        expect(
          rows.find((row) => row.id === producerOrgId)?.name,
        ).toBe(
          `Counterparty producer ${runId}`,
        );
      },
    );

    it(
      "lets a GRANTEE resolve its GRANTOR name for an EXPIRED grant and for a lapsed-but-still-ACTIVE grant",
      async () => {
        // There is no expiry job (20260831120000), so a lapsed grant sits
        // at status ACTIVE with expires_at in the past indefinitely. Both
        // terminal shapes must keep naming the grantor, or an importer
        // loses the provenance of a figure it has already frozen.
        //
        // expires_at is set AT INSERT rather than backdated afterwards:
        // app.prevent_sharing_grant_fact_change permits only status,
        // updated_at and the one-time grantee_org_id resolution to change
        // via UPDATE, and that immutability is itself a control worth not
        // working around in a test.
        const { data: lapsed, error: lapsedError } =
          await clientProducerOwner
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                grantee_org_id: importerOrgId,
                installation_id: thirdInstallationId,
                created_by_user_id: producerOwnerId,
                expires_at: "2020-01-01T00:00:00.000Z",
              },
            )
            .select("id")
            .single();

        expect(lapsedError).toBeNull();

        const { error: activateError } =
          await clientImporterOwner
            .from("sharing_grants")
            .update(
              { status: "ACTIVE" },
            )
            .eq("id", lapsed!.id);

        expect(activateError).toBeNull();

        const rowsAfterLapse =
          await counterpartyNames(
            clientImporterOwner,
          );

        expect(
          rowsAfterLapse.map((row) => row.id),
        ).toContain(
          producerOrgId,
        );

        // EXPIRED is reachable only lazily, when an accept attempt finds
        // a lapsed row (20260829390000); no product path sets it
        // directly, and the grantor RLS update policy permits only
        // REVOKED. Service role is used for this one status flip so the
        // EXPIRED disclosure rule can be asserted at all -- the shape
        // under test is the function, not how a row reaches EXPIRED.
        const { error: expireError } =
          await serviceClient
            .from("sharing_grants")
            .update(
              { status: "EXPIRED" },
            )
            .eq("id", lapsed!.id);

        expect(expireError).toBeNull();

        const rowsAfterExpiry =
          await counterpartyNames(
            clientImporterOwner,
          );

        expect(
          rowsAfterExpiry.map((row) => row.id),
        ).toContain(
          producerOrgId,
        );
      },
    );

    it(
      "lets a GRANTOR resolve the GRANTEE name of a bootstrap grant the grantee genuinely accepted, after revocation",
      async () => {
        const rows =
          await counterpartyNames(
            clientProducerOwner,
          );

        expect(
          rows.map((row) => row.id),
        ).toContain(
          importerOrgId,
        );
      },
    );

    it(
      "does NOT let a GRANTOR resolve the GRANTEE name of a terminal DIRECT grant -- no acceptance proof, so a self-issued self-revoked sham grant discloses nothing",
      async () => {
        // The documented boundary. An attacker who knows a victim org
        // uuid can issue an INVITED direct grant naming it and then
        // revoke their own grant; if that disclosed the name, the
        // sequence would turn a known uuid into an organization name with
        // no consent anywhere in the loop.
        const whileInvited =
          await counterpartyNames(
            clientProducerOwner,
          );

        expect(
          whileInvited.map((row) => row.id),
        ).not.toContain(
          victimOrgId,
        );

        const { error: revokeError } =
          await clientProducerOwner
            .from("sharing_grants")
            .update(
              { status: "REVOKED" },
            )
            .eq(
              "id",
              directRevokedGrantId,
            );

        expect(revokeError).toBeNull();

        const afterRevoke =
          await counterpartyNames(
            clientProducerOwner,
          );

        expect(
          afterRevoke.map((row) => row.id),
        ).not.toContain(
          victimOrgId,
        );
      },
    );

    it(
      "discloses nothing at all to a stranger org with no grant relationship in either direction",
      async () => {
        const rows =
          await counterpartyNames(
            clientStrangerOwner,
          );

        expect(rows).toEqual(
          [],
        );
      },
    );

    it(
      "returns exactly (id, name) and no other organization column",
      async () => {
        const rows =
          await counterpartyNames(
            clientImporterOwner,
          );

        expect(rows.length).toBeGreaterThan(
          0,
        );

        for (const row of rows) {
          expect(
            Object.keys(row).sort(),
          ).toEqual(
            ["id", "name"],
          );
        }
      },
    );

    it(
      "refuses at INSERT to mint the accepted-bootstrap shape directly -- the acceptance proof direction 2 relies on cannot be fabricated, even by service_role",
      async () => {
        // Until 20260902150000 this was enforced only by an RLS INSERT
        // policy, which service_role bypasses, while the table CHECK is
        // an OR rather than an XOR. The disclosure rule for direction 2
        // reads (invited_email AND grantee_org_id) as proof that
        // accept_sharing_grant_invitation() ran, so that shape must be
        // unreachable at INSERT from every path, not just from RLS-bound
        // ones.
        const { error: bothColumns } =
          await serviceClient
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                grantee_org_id: victimOrgId,
                invited_email: `forged-${runId}@example.com`,
                installation_id: fourthInstallationId,
                created_by_user_id: producerOwnerId,
              },
            );

        expect(bothColumns).not.toBeNull();
        expect(bothColumns?.message).toContain(
          "exactly one of grantee_org_id",
        );

        const { error: neitherColumn } =
          await serviceClient
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                installation_id: fourthInstallationId,
                created_by_user_id: producerOwnerId,
              },
            );

        expect(neitherColumn).not.toBeNull();
        expect(neitherColumn?.message).toContain(
          "exactly one of grantee_org_id",
        );
      },
    );

    /**
     * 2026-09-03 (P14). The database half of the acceptance capability
     * gate, proven live rather than inferred from the SQL.
     *
     * Accepting binds a producer's verified emissions data to an
     * organization permanently -- grantee_org_id may change exactly once,
     * from null -- and admits every member of that organization to the
     * data. The RPC previously required only that the caller be an active
     * member of the target org, and the target is supplied by the
     * application from the cookie-derived ACTIVE organization. So a user
     * belonging to two non-grantor orgs bound the grant to whichever one
     * they were acting as.
     *
     * This is the dual-org case exactly: the same user is an owner of the
     * importer org AND a member of a second, producer-only org.
     */
    it(
      "refuses, in the database, to bind a grant to an organization that does not hold IMPORTER_DECLARANT",
      async () => {
        const wrongOrgId =
          await createOrg("wrong-target", ["PRODUCER_OPERATOR"]);

        await addMembership(
          wrongOrgId,
          importerOwnerId,
          "OWNER",
        );

        const { data: grant, error: grantError } =
          await clientProducerOwner
            .from("sharing_grants")
            .insert(
              {
                grantor_org_id: producerOrgId,
                invited_email: `counterparty-importer-owner-${runId}@example.com`,
                installation_id: fourthInstallationId,
                created_by_user_id: producerOwnerId,
              },
            )
            .select("id")
            .single();

        expect(grantError).toBeNull();

        // The user is a genuine, active OWNER of the target org and the
        // invitation is genuinely addressed to them. Membership alone
        // used to be enough.
        const { data: refused, error: refusedError } =
          await clientImporterOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: grant!.id,
              p_org_id: wrongOrgId,
            },
          );

        expect(refusedError).toBeNull();

        expect(
          (refused as { result_status: string }[])[0]?.result_status,
        ).toBe(
          "CAPABILITY_NOT_HELD",
        );

        // Nothing was bound.
        const { data: unchanged } =
          await serviceClient
            .from("sharing_grants")
            .select("status, grantee_org_id")
            .eq("id", grant!.id)
            .single();

        expect(unchanged?.status).toBe(
          "INVITED",
        );

        expect(unchanged?.grantee_org_id).toBeNull();

        // And the same user, accepting into their IMPORTER org, still
        // succeeds -- the gate blocks the wrong target, not the person.
        const { data: accepted } =
          await clientImporterOwner.rpc(
            "accept_sharing_grant_invitation",
            {
              p_grant_id: grant!.id,
              p_org_id: importerOrgId,
            },
          );

        expect(
          (accepted as { result_status: string }[])[0]?.result_status,
        ).toBe(
          "OK",
        );
      },
    );
  },
);
