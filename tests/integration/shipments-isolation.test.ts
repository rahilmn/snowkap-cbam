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

// Standing isolation suite for the P4 shipment-intake tables
// (shipments, shipment_lines, suppliers), extending the same pattern
// as tests/integration/organizations-isolation.test.ts -- see that
// file's header comment for the local-only-instance rationale, the
// fixed local demo JWTs (not secrets), and the skip-not-fail
// discipline when local Supabase isn't reachable.
//
// This suite specifically codifies the RLS behaviors found and fixed
// by an adversarial design review during this same phase (see
// 20260829090000_p4_shipment_tenancy_hardening.sql's header comment)
// and manually verified live before being trusted -- turning that
// one-off manual verification into permanent regression coverage
// rather than leaving it as something only ever checked once.

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
  "shipments/shipment_lines/suppliers RLS (local Supabase only)",
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

    let clientOwnerA: SupabaseClient;
    let clientMemberA: SupabaseClient;
    let clientOwnerB: SupabaseClient;

    let shipmentAId: string;

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
      const { data: orgA, error: orgAError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Shipments Isolation Org A ${runId}`,
              slug: `shipments-isolation-org-a-${runId}`,
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
              name: `Shipments Isolation Org B ${runId}`,
              slug: `shipments-isolation-org-b-${runId}`,
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
        `shipments-isolation-password-${runId}!`;

      const { data: ownerA, error: ownerAError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `shipments-isolation-owner-a-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (ownerAError || !ownerA.user) {
        throw new Error(
          `Failed to create owner A: ${ownerAError?.message}`,
        );
      }

      ownerAId = ownerA.user.id;

      const { data: memberA, error: memberAError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `shipments-isolation-member-a-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (memberAError || !memberA.user) {
        throw new Error(
          `Failed to create member A: ${memberAError?.message}`,
        );
      }

      memberAId = memberA.user.id;

      const { data: ownerB, error: ownerBError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `shipments-isolation-owner-b-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (ownerBError || !ownerB.user) {
        throw new Error(
          `Failed to create owner B: ${ownerBError?.message}`,
        );
      }

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: orgAId, user_id: ownerAId, role: "OWNER" },
              { org_id: orgAId, user_id: memberAId, role: "MEMBER" },
              { org_id: orgBId, user_id: ownerB.user.id, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientOwnerA =
        await signInAnonClient(
          `shipments-isolation-owner-a-${runId}@example.com`,
          password,
        );

      clientMemberA =
        await signInAnonClient(
          `shipments-isolation-member-a-${runId}@example.com`,
          password,
        );

      clientOwnerB =
        await signInAnonClient(
          `shipments-isolation-owner-b-${runId}@example.com`,
          password,
        );

      const { data: shipmentA, error: shipmentAError } =
        await clientOwnerA
          .from("shipments")
          .insert(
            {
              org_id: orgAId,
              reference: `SHIP-ISO-${runId}`,
              release_date: "2026-03-15",
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              status: "DRAFT",
            },
          )
          .select("id")
          .single();

      if (shipmentAError || !shipmentA) {
        throw new Error(
          `Failed to create shipment A: ${shipmentAError?.message}`,
        );
      }

      shipmentAId = shipmentA.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("shipments")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("suppliers")
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
        const id of [ownerAId, memberAId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "org B cannot see org A's shipment",
      async () => {
        const { data } =
          await clientOwnerB
            .from("shipments")
            .select("id")
            .eq(
              "id",
              shipmentAId,
            );

        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "org B cannot see org A's shipment via an unfiltered query either",
      async () => {
        const { data } =
          await clientOwnerB
            .from("shipments")
            .select("id");

        expect(
          (data ?? []).some(
            (row) => row.id === shipmentAId,
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "org B cannot insert a shipment_line onto org A's shipment",
      async () => {
        const { error } =
          await clientOwnerB
            .from("shipment_lines")
            .insert(
              {
                shipment_id: shipmentAId,
                org_id: orgBId,
                line_number: 1,
                cn_code: "25232100",
                cn_code_level: "CN8",
                origin_country: "DE",
                net_mass_tonnes: "1",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "org_id cannot be reassigned via UPDATE, even by the shipment's own org's OWNER",
      async () => {
        // app.prevent_org_id_change() (20260829090000) blocks the
        // column change unconditionally -- this specific case (target
        // is a DIFFERENT org the caller ISN'T even a member of) would
        // also be caught by the WITH CHECK's org_id-in-my-own-orgs
        // clause alone; the real gap this migration closed is a
        // caller reassigning to an org they genuinely DO belong to
        // (see that migration's header comment for the concrete
        // dual-membership scenario) -- not reproduced here since it
        // needs a second real membership on the same user, but the
        // trigger itself does not distinguish the two cases, so this
        // still exercises the actual guard.
        const { error } =
          await clientOwnerA
            .from("shipments")
            .update(
              { org_id: orgBId },
            )
            .eq(
              "id",
              shipmentAId,
            );

        expect(error).not.toBeNull();
        expect(error?.message).toContain(
          "immutable",
        );
      },
    );

    it(
      "an ordinary field update on the same shipment still succeeds",
      async () => {
        const { error, data } =
          await clientOwnerA
            .from("shipments")
            .update(
              { customs_mrn: "MRN-ISO-TEST" },
            )
            .eq(
              "id",
              shipmentAId,
            )
            .select(
              "customs_mrn",
            )
            .single();

        expect(error).toBeNull();
        expect(data?.customs_mrn).toBe(
          "MRN-ISO-TEST",
        );
      },
    );

    it(
      "a plain MEMBER cannot LOCK a READY shipment; the OWNER can",
      async () => {
        const { error: readyError } =
          await clientOwnerA
            .from("shipments")
            .update(
              { status: "READY" },
            )
            .eq(
              "id",
              shipmentAId,
            );

        expect(readyError).toBeNull();

        const { data: memberLockData } =
          await clientMemberA
            .from("shipments")
            .update(
              { status: "LOCKED" },
            )
            .eq(
              "id",
              shipmentAId,
            )
            .select(
              "status",
            );

        // RLS excludes the row rather than erroring -- 0 rows affected
        // (supabase-js returns null, not [], for a zero-row
        // update().select() without .single()/.maybeSingle()).
        expect(
          memberLockData ?? [],
        ).toEqual(
          [],
        );

        const { data: currentStatus } =
          await clientOwnerA
            .from("shipments")
            .select("status")
            .eq(
              "id",
              shipmentAId,
            )
            .single();

        expect(currentStatus?.status).toBe(
          "READY",
        );

        const { error: ownerLockError, data: ownerLockData } =
          await clientOwnerA
            .from("shipments")
            .update(
              { status: "LOCKED" },
            )
            .eq(
              "id",
              shipmentAId,
            )
            .select(
              "status",
            )
            .single();

        expect(ownerLockError).toBeNull();
        expect(ownerLockData?.status).toBe(
          "LOCKED",
        );
      },
    );

    it(
      "a LOCKED shipment's lines can no longer be inserted, updated, or deleted",
      async () => {
        const { error: insertError } =
          await clientOwnerA
            .from("shipment_lines")
            .insert(
              {
                shipment_id: shipmentAId,
                org_id: orgAId,
                line_number: 1,
                cn_code: "25232100",
                cn_code_level: "CN8",
                origin_country: "DE",
                net_mass_tonnes: "1",
              },
            );

        expect(insertError).not.toBeNull();
      },
    );

    it(
      "org A's suppliers are invisible to org B",
      async () => {
        const { data: supplier, error: supplierError } =
          await clientOwnerA
            .from("suppliers")
            .insert(
              {
                org_id: orgAId,
                name: `Isolation Supplier ${runId}`,
              },
            )
            .select(
              "id",
            )
            .single();

        expect(supplierError).toBeNull();

        const { data } =
          await clientOwnerB
            .from("suppliers")
            .select("id")
            .eq(
              "id",
              supplier?.id,
            );

        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "org B cannot reassign an org A supplier's org_id either",
      async () => {
        const { data: supplier } =
          await clientOwnerA
            .from("suppliers")
            .insert(
              {
                org_id: orgAId,
                name: `Isolation Supplier Reassign Target ${runId}`,
              },
            )
            .select(
              "id",
            )
            .single();

        const { error } =
          await clientOwnerA
            .from("suppliers")
            .update(
              { org_id: orgBId },
            )
            .eq(
              "id",
              supplier?.id,
            );

        expect(error).not.toBeNull();
        expect(error?.message).toContain(
          "immutable",
        );
      },
    );
  },
);
