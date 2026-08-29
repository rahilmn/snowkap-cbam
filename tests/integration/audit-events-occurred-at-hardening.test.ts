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

// Adversarial standing suite for the P13 release-blocker remediation
// (supabase/migrations/20260829520000_p13_review_audit_events_occurred_at_immutable.sql)
// -- audit_events.occurred_at was entirely client-supplied and
// unconstrained. Live-reproduced by the P13 final adversarial audit: a
// plain MEMBER could insert a row with occurred_at far in the future
// (or past), and because listAuditEvents orders by `occurred_at desc,
// id desc` with a hard 200-row limit and no pagination, and
// audit_events carries no UPDATE/DELETE policy by design, enough
// forged far-future rows permanently push every real event off the
// org's only Audit screen with no way to remove them. Same
// live-Postgres, rolled-back-transaction discipline as every other
// suite in this directory.

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
  "audit_events occurred_at hardening (P13 release-blocker remediation, local Supabase only)",
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

    let orgId: string;
    let memberId: string;
    let clientMember: SupabaseClient;

    beforeAll(async () => {
      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Audit Occurred At Hardening ${runId}`,
              slug: `audit-occurred-at-hardening-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (orgError || !org) {
        throw new Error(
          `Failed to create org: ${orgError?.message}`,
        );
      }

      orgId = org.id;

      const password =
        `audit-occurred-at-hardening-password-${runId}!`;

      const { data: memberUser, error: memberUserError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `audit-occurred-at-hardening-member-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (memberUserError || !memberUser.user) {
        throw new Error(
          `Failed to create member user: ${memberUserError?.message}`,
        );
      }

      memberId = memberUser.user.id;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            { org_id: orgId, user_id: memberId, role: "MEMBER" },
          );

      if (membershipError) {
        throw new Error(
          `Failed to create membership: ${membershipError.message}`,
        );
      }

      clientMember =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          {
            auth: { persistSession: false },
          },
        );

      const { error: signInError } =
        await clientMember.auth.signInWithPassword(
          {
            email: `audit-occurred-at-hardening-member-${runId}@example.com`,
            password,
          },
        );

      if (signInError) {
        throw new Error(
          `Failed to sign in member: ${signInError.message}`,
        );
      }
    });

    afterAll(async () => {
      await serviceClient
        .from("audit_events")
        .delete()
        .eq(
          "org_id",
          orgId,
        );

      await serviceClient
        .from("memberships")
        .delete()
        .eq(
          "org_id",
          orgId,
        );

      await serviceClient
        .from("organizations")
        .delete()
        .eq(
          "id",
          orgId,
        );

      await serviceClient.auth.admin.deleteUser(
        memberId,
      );
    });

    it(
      "silently overrides a far-future client-supplied occurred_at with the real current time -- a plain MEMBER cannot backdate or future-date an audit event",
      async () => {
        const before =
          new Date();

        const { data, error } =
          await clientMember
            .from("audit_events")
            .insert(
              {
                org_id: orgId,
                actor_type: "USER",
                actor_user_id: memberId,
                event_type: "shipment.created",
                aggregate_type: "SHIPMENT",
                aggregate_id: "forged-future-event",
                occurred_at: "2999-01-01T00:00:00.000Z",
              },
            )
            .select("occurred_at")
            .single();

        expect(error).toBeNull();

        const occurredAt =
          new Date(
            data?.occurred_at as string,
          );

        expect(
          occurredAt.getFullYear(),
        ).toBeLessThan(
          2100,
        );

        expect(
          occurredAt.getTime(),
        ).toBeGreaterThanOrEqual(
          before.getTime() - 5_000,
        );
      },
    );

    it(
      "silently overrides a backdated client-supplied occurred_at the same way",
      async () => {
        const before =
          new Date();

        const { data, error } =
          await clientMember
            .from("audit_events")
            .insert(
              {
                org_id: orgId,
                actor_type: "USER",
                actor_user_id: memberId,
                event_type: "shipment.created",
                aggregate_type: "SHIPMENT",
                aggregate_id: "forged-past-event",
                occurred_at: "2019-01-01T00:00:00.000Z",
              },
            )
            .select("occurred_at")
            .single();

        expect(error).toBeNull();

        const occurredAt =
          new Date(
            data?.occurred_at as string,
          );

        expect(
          occurredAt.getFullYear(),
        ).toBeGreaterThan(
          2020,
        );

        expect(
          occurredAt.getTime(),
        ).toBeGreaterThanOrEqual(
          before.getTime() - 5_000,
        );
      },
    );
  },
);
