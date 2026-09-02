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

/**
 * Owner decision D2, proven against real Postgres rather than inferred
 * from the SQL.
 *
 * An importer must be able to record a supplier's operator,
 * installation and emissions information when that operator does not
 * use Snowkap. What must NOT happen is that the resulting data becomes
 * indistinguishable from data the operator attested to themselves.
 *
 * `IMPORTER_ENTERED` means "transcribed from an external operator".
 * `OPERATOR_PROVIDED` means "the operator that runs this installation
 * entered it". A declarant relying on either has to know which one they
 * hold, so the difference is enforced in the database at two points:
 *
 *   1. Which provenance an organization may CLAIM follows from what it
 *      is, and cannot be rewritten afterwards.
 *   2. A frozen determination's own provenance claim is checked against
 *      the installation's.
 *
 * Both are exercised through ordinary authenticated clients under RLS,
 * because what a real caller can do is the question. The service role
 * appears in exactly two places, deliberately: to seed organizations and
 * users, and to prove that the immutability wall is a TRIGGER rather
 * than a policy -- a distinction that only shows up when RLS is
 * bypassed.
 */

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_API_URL ?? "http://127.0.0.1:54321";

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
        `${LOCAL_API_URL}/rest/v1/`,
        {
          headers: { apikey: LOCAL_ANON_KEY },
          signal: AbortSignal.timeout(2000),
        },
      );

    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

const localSupabaseReachable =
  await isLocalSupabaseReachable();

describe.skipIf(!localSupabaseReachable)(
  "importer-entered provenance (D2, local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(0, 8);

    const password =
      `provenance-password-${runId}!`;

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    const createdOrgIds: string[] =
      [];

    const createdUserIds: string[] =
      [];

    let producerOrgId: string;
    let importerOrgId: string;
    let dualOrgId: string;

    let clientProducer: SupabaseClient;
    let clientImporter: SupabaseClient;
    let clientDual: SupabaseClient;

    async function createOrg(
      label: string,
      capabilities: string[],
    ): Promise<string> {
      const { data, error } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Provenance ${label} ${runId}`,
              slug: `provenance-${label}-${runId}`,
              capabilities,
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to create org ${label}: ${error?.message}`,
        );
      }

      createdOrgIds.push(data.id);

      return data.id;
    }

    async function createOwner(
      label: string,
      orgId: string,
    ): Promise<SupabaseClient> {
      const email =
        `provenance-${label}-${runId}@example.com`;

      const { data, error } =
        await serviceClient.auth.admin.createUser(
          { email, password, email_confirm: true },
        );

      if (error || !data.user) {
        throw new Error(
          `Failed to create ${email}: ${error?.message}`,
        );
      }

      createdUserIds.push(data.user.id);

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            { org_id: orgId, user_id: data.user.id, role: "OWNER" },
          );

      if (membershipError) {
        throw new Error(
          `Failed to add ${label} owner: ${membershipError.message}`,
        );
      }

      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error: signInError } =
        await client.auth.signInWithPassword(
          { email, password },
        );

      if (signInError) {
        throw new Error(
          `Failed to sign in ${email}: ${signInError.message}`,
        );
      }

      return client;
    }

    beforeAll(async () => {
      producerOrgId =
        await createOrg("producer", ["PRODUCER_OPERATOR"]);

      importerOrgId =
        await createOrg("importer", ["IMPORTER_DECLARANT"]);

      dualOrgId =
        await createOrg(
          "dual",
          ["PRODUCER_OPERATOR", "IMPORTER_DECLARANT"],
        );

      clientProducer =
        await createOwner("producer", producerOrgId);

      clientImporter =
        await createOwner("importer", importerOrgId);

      clientDual =
        await createOwner("dual", dualOrgId);
    });

    afterAll(async () => {
      for (const orgId of createdOrgIds) {
        await serviceClient
          .from("installations")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("operators")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("memberships")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("organizations")
          .delete()
          .eq("id", orgId);
      }

      for (const userId of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(userId);
      }
    });

    async function insertOperator(
      client: SupabaseClient,
      orgId: string,
      provenance: string,
      label: string,
    ) {
      return client
        .from("operators")
        .insert(
          {
            org_id: orgId,
            provenance,
            name: `${label} ${runId}`,
            country: "IN",
          },
        )
        .select("id")
        .single();
    }

    it(
      "lets an importer record an EXTERNAL operator as IMPORTER_ENTERED -- the workflow D2 exists to enable",
      async () => {
        // Before D2 this was impossible through the product: the
        // services required PRODUCER_OPERATOR, so an importer whose
        // supplier was not on Snowkap could not record that supplier at
        // all.
        const { data, error } =
          await insertOperator(
            clientImporter,
            importerOrgId,
            "IMPORTER_ENTERED",
            "External Operator",
          );

        expect(error).toBeNull();
        expect(data?.id).toBeTruthy();
      },
    );

    it(
      "refuses an importer claiming OPERATOR_PROVIDED",
      async () => {
        // The distinction D2 must not lose. An importer transcribing a
        // supplier's figures is not the supplier attesting to them, and
        // claiming otherwise would make the two indistinguishable on
        // every screen and in every export that reads provenance.
        const { error } =
          await insertOperator(
            clientImporter,
            importerOrgId,
            "OPERATOR_PROVIDED",
            "Falsely Attested Operator",
          );

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "Only a producer / operator organization",
        );
      },
    );

    it(
      "refuses a producer claiming IMPORTER_ENTERED",
      async () => {
        // The mirror case. A producer entering its own installation is
        // not transcribing someone else's data, and mislabelling it
        // would understate the attestation behind the numbers.
        const { error } =
          await insertOperator(
            clientProducer,
            producerOrgId,
            "IMPORTER_ENTERED",
            "Mislabelled Operator",
          );

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "Only an importer / declarant organization",
        );
      },
    );

    it(
      "lets an organization holding BOTH capabilities claim either",
      async () => {
        // Correct rather than a loophole: such an organization genuinely
        // does both things, and it is the RECORD's provenance -- not the
        // organization's -- that says where a number came from.
        const { error: operatorProvided } =
          await insertOperator(
            clientDual,
            dualOrgId,
            "OPERATOR_PROVIDED",
            "Dual Own Operator",
          );

        expect(operatorProvided).toBeNull();

        const { error: importerEntered } =
          await insertOperator(
            clientDual,
            dualOrgId,
            "IMPORTER_ENTERED",
            "Dual External Operator",
          );

        expect(importerEntered).toBeNull();
      },
    );

    it(
      "refuses to rewrite provenance after the fact",
      async () => {
        // Provenance records how a record came to exist. If it could be
        // updated, transcribed operator data could become
        // operator-attested data with a single write, and every frozen
        // determination that named it would silently change meaning.
        const { data: operator } =
          await insertOperator(
            clientImporter,
            importerOrgId,
            "IMPORTER_ENTERED",
            "Immutable Operator",
          );

        // Two walls, and they fail differently -- which is worth
        // pinning, because relying on the wrong one would be a
        // false sense of security.
        //
        // Wall one, for an ordinary caller: `operators` has no UPDATE
        // policy at all, so the statement is not refused, it simply
        // matches zero rows. Asserting "no error" here is not a
        // weakness; it is the honest shape of an RLS-filtered update,
        // and the row is checked afterwards.
        const { data: updated, error } =
          await clientImporter
            .from("operators")
            .update(
              { provenance: "OPERATOR_PROVIDED" },
            )
            .eq("id", operator!.id)
            .select("id");

        expect(error).toBeNull();

        expect(updated).toEqual(
          [],
        );

        // Wall two, for anything that bypasses RLS -- a migration, a
        // seed, a SECURITY DEFINER function, the service role: the
        // trigger refuses outright. Without this, "provenance is
        // immutable" would be true only of callers who were already
        // being filtered.
        const { error: serviceRoleError } =
          await serviceClient
            .from("operators")
            .update(
              { provenance: "OPERATOR_PROVIDED" },
            )
            .eq("id", operator!.id);

        expect(serviceRoleError).not.toBeNull();

        expect(serviceRoleError?.message).toContain(
          "cannot be changed",
        );

        const { data: unchanged } =
          await serviceClient
            .from("operators")
            .select("provenance")
            .eq("id", operator!.id)
            .single();

        expect(
          (unchanged as { provenance: string }).provenance,
        ).toBe(
          "IMPORTER_ENTERED",
        );
      },
    );

    it(
      "refuses even the service role -- the wall is a trigger, not a policy",
      async () => {
        // RLS is bypassed by the service role; a trigger is not. Stated
        // as a test because "the application checks it" and "the
        // database enforces it" are different claims, and only the
        // second one holds against a migration, a seed, or a
        // SECURITY DEFINER function.
        const { error } =
          await serviceClient
            .from("operators")
            .insert(
              {
                org_id: importerOrgId,
                provenance: "OPERATOR_PROVIDED",
                name: `Service Role Bypass ${runId}`,
                country: "IN",
              },
            );

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "Only a producer / operator organization",
        );
      },
    );

    it(
      "keeps an importer's own external records invisible to every other organization",
      async () => {
        // D2 opens a write surface. It must not open a read one: an
        // importer recording a third party's installation is recording
        // it for themselves, and must not thereby learn anything about,
        // or expose anything to, another Snowkap organization.
        const { data: mine } =
          await insertOperator(
            clientImporter,
            importerOrgId,
            "IMPORTER_ENTERED",
            "Private External Operator",
          );

        const { data: seenByProducer } =
          await clientProducer
            .from("operators")
            .select("id")
            .eq("id", mine!.id);

        expect(seenByProducer).toEqual(
          [],
        );

        const { data: seenByDual } =
          await clientDual
            .from("operators")
            .select("id")
            .eq("id", mine!.id);

        expect(seenByDual).toEqual(
          [],
        );
      },
    );
  },
);
