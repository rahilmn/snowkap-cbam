import {
  describe,
  expect,
  it,
} from "vitest";

import {
  acceptSharingGrant,
  acceptSharingGrantInvitation,
  issueSharingGrant,
  listMyPendingSharingGrantInvitations,
  listSharingGrantsIssued,
  listSharingGrantsReceived,
  revokeSharingGrant,
} from "./manage-sharing-grants";

const orgId =
  "org-1" as never;

const granteeOrgId =
  "org-2" as never;

const adminContext =
  {
    org_id: "org-1",
    user_id: "admin-1",
    role: "ADMIN",
    capabilities: ["PRODUCER_OPERATOR"],
  } as never;

const memberContext =
  {
    org_id: "org-1",
    user_id: "member-1",
    role: "MEMBER",
    capabilities: ["PRODUCER_OPERATOR"],
  } as never;

const granteeAdminContext =
  {
    org_id: "org-2",
    user_id: "grantee-admin-1",
    role: "ADMIN",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const granteeMemberContext =
  {
    org_id: "org-2",
    user_id: "grantee-member-1",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const baseRow =
  {
    id: "grant-1",
    grantor_org_id: "org-1",
    grantee_org_id: "org-2",
    invited_email: null,
    installation_id: "installation-1",
    status: "INVITED",
    created_by_user_id: "admin-1",
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

interface Op {
  table: string;
  op: "insert" | "update" | "delete";
  payload: unknown;
  filters: [string, unknown][];
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
}

/**
 * Same generic chainable mock as manage-emission-data.test.ts's own
 * makeMockSupabase -- reused verbatim (not re-derived) because
 * manage-sharing-grants.ts issues the same "fetch, apply pure lifecycle
 * function, persist, audit" call shape against a table (sharing_grants)
 * this mock has no bespoke knowledge of either.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>,
  recorder: Recorder = { fromCalls: [], ops: [] },
  rpcResult?: { data: unknown; error: unknown },
) {
  const cursors: Record<string, number> = {};

  function nextResult(
    table: string,
  ): { data: unknown; error: unknown } {
    const entry =
      tables[table];

    if (!entry) {
      return { data: null, error: null };
    }

    if (!Array.isArray(entry)) {
      return entry;
    }

    const index =
      cursors[table] ?? 0;

    cursors[table] =
      Math.min(index + 1, entry.length - 1);

    return entry[Math.min(index, entry.length - 1)]!;
  }

  function builder(
    table: string,
  ) {
    const filters: [string, unknown][] =
      [];

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      neq: (col: string, val: unknown) => {
        filters.push([col, `neq:${String(val)}`]);
        return chain;
      },
      in: (col: string, vals: unknown) => {
        filters.push([col, vals]);
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      not: (col: string, op: string, val: unknown) => {
        filters.push([col, `not.${op}:${String(val)}`]);
        return chain;
      },
      order: () => chain,
      insert: (payload: unknown) => {
        recorder.ops.push({ table, op: "insert", payload, filters });
        return chain;
      },
      update: (payload: unknown) => {
        recorder.ops.push({ table, op: "update", payload, filters });
        return chain;
      },
      delete: () => {
        recorder.ops.push({ table, op: "delete", payload: undefined, filters });
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve(
          nextResult(table),
        ),
      single: () =>
        Promise.resolve(
          nextResult(table),
        ),
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          nextResult(table),
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => {
      recorder.fromCalls.push(table);
      return builder(table);
    },

    // Only exercised by acceptSharingGrantInvitation -- every other
    // function in this file talks to sharing_grants via plain
    // from()/select()/update(), same as acceptSharingGrant/
    // revokeSharingGrant above.
    rpc: (fnName: string, args: unknown) => {
      recorder.ops.push(
        { table: `rpc:${fnName}`, op: "insert", payload: args, filters: [] },
      );

      return Promise.resolve(
        rpcResult ?? { data: null, error: null },
      );
    },
  } as never;
}

describe(
  "listSharingGrantsIssued",
  () => {
    it(
      "maps rows to SharingGrant objects filtered by grantor_org_id",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await listSharingGrantsIssued(
            makeMockSupabase(
              { sharing_grants: { data: [baseRow], error: null } },
              recorder,
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              { id: "grant-1", status: "INVITED", grantor_org_id: "org-1" },
            ),
          ],
        );
      },
    );

    it(
      "returns an empty array on a fetch error",
      async () => {
        const result =
          await listSharingGrantsIssued(
            makeMockSupabase(
              { sharing_grants: { data: null, error: { message: "denied" } } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "listSharingGrantsReceived",
  () => {
    it(
      "maps rows to SharingGrant objects filtered by grantee_org_id",
      async () => {
        const result =
          await listSharingGrantsReceived(
            makeMockSupabase(
              { sharing_grants: { data: [baseRow], error: null } },
            ),
            granteeOrgId,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              { id: "grant-1", status: "INVITED", grantee_org_id: "org-2" },
            ),
          ],
        );
      },
    );

    it(
      "returns an empty array on a fetch error",
      async () => {
        const result =
          await listSharingGrantsReceived(
            makeMockSupabase(
              { sharing_grants: { data: null, error: { message: "denied" } } },
            ),
            granteeOrgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "issueSharingGrant",
  () => {
    const validInput =
      {
        installationId: "installation-1" as never,
        granteeOrgId: "org-2" as never,
      };

    it(
      "creates an INVITED grant when the caller is ADMIN and owns the installation",
      async () => {
        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-1" }, error: null },
                sharing_grants: { data: baseRow, error: null },
              },
            ),
            adminContext,
            validInput,
          );

        expect(result).toEqual(
          {
            status: "OK",
            grant: expect.objectContaining(
              { status: "INVITED", grantor_org_id: "org-1", grantee_org_id: "org-2" },
            ),
          },
        );
      },
    );

    it(
      "rejects PERMISSION_DENIED for a plain MEMBER, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            memberContext,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects SELF_GRANT_NOT_ALLOWED when granteeOrgId equals the caller's own active org, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            adminContext,
            { ...validInput, granteeOrgId: "org-1" as never },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SELF_GRANT_NOT_ALLOWED" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects INSTALLATION_NOT_FOUND when the installation belongs to a different org than the caller's active org",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-9" }, error: null },
              },
              recorder,
            ),
            adminContext,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
        );

        expect(
          recorder.ops.some((op) => op.table === "sharing_grants"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the insert fails",
      async () => {
        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-1" }, error: null },
                sharing_grants: { data: null, error: { message: "denied" } },
              },
            ),
            adminContext,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "records a sharing_grant.issued audit event on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await issueSharingGrant(
          makeMockSupabase(
            {
              installations: { data: { org_id: "org-1" }, error: null },
              sharing_grants: { data: baseRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          adminContext,
          validInput,
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        expect(auditOp).toBeDefined();

        expect(
          (auditOp?.payload as { event_type: string }).event_type,
        ).toBe(
          "sharing_grant.issued",
        );
      },
    );

    // Bootstrap path (P7-D2, 20260829300000): the producer doesn't yet
    // know the importer's org, so granteeOrgId is omitted and
    // invitedEmail carries the address instead.
    it(
      "creates an INVITED grant with invited_email (bootstrap path) when granteeOrgId is omitted",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const bootstrapRow =
          {
            ...baseRow,
            grantee_org_id: null,
            invited_email: "buyer@example.com",
          };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-1" }, error: null },
                sharing_grants: { data: bootstrapRow, error: null },
              },
              recorder,
            ),
            adminContext,
            {
              installationId: "installation-1" as never,
              invitedEmail: "  Buyer@Example.com  ",
            },
          );

        expect(result).toEqual(
          {
            status: "OK",
            grant: expect.objectContaining(
              { status: "INVITED", grantee_org_id: null, invited_email: "buyer@example.com" },
            ),
          },
        );

        const insertOp =
          recorder.ops.find(
            (op) => op.table === "sharing_grants" && op.op === "insert",
          );

        expect(
          insertOp?.payload,
        ).toMatchObject(
          { invited_email: "buyer@example.com", grantee_org_id: null },
        );
      },
    );

    it(
      "rejects INVALID_INPUT when neither granteeOrgId nor invitedEmail is provided, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            adminContext,
            { installationId: "installation-1" as never },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_INPUT" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects INVALID_INPUT when both granteeOrgId and invitedEmail are provided, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            adminContext,
            { ...validInput, invitedEmail: "buyer@example.com" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_INPUT" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects INVALID_INPUT when invitedEmail is not a valid email shape, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await issueSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            adminContext,
            { installationId: "installation-1" as never, invitedEmail: "not-an-email" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_INPUT" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "acceptSharingGrant",
  () => {
    it(
      "accepts an INVITED grant when the caller's active org matches grantee_org_id",
      async () => {
        const result =
          await acceptSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: [
                  { data: baseRow, error: null },
                  { data: { ...baseRow, status: "ACTIVE" }, error: null },
                ],
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          {
            status: "OK",
            grant: expect.objectContaining({ status: "ACTIVE", grantee_org_id: "org-2" }),
          },
        );
      },
    );

    it(
      "rejects GRANT_NOT_INVITED (not a silent OK) when the CAS predicate matches zero rows -- e.g. the grant was concurrently revoked between fetch and update",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await acceptSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: [
                  { data: baseRow, error: null },
                  { data: null, error: null },
                ],
                audit_events: { data: null, error: null },
              },
              recorder,
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "GRANT_NOT_INVITED" },
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects NOT_FOUND when the grant's grantee_org_id doesn't match the caller's active org",
      async () => {
        const result =
          await acceptSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: { data: { ...baseRow, grantee_org_id: "org-3" }, error: null },
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      "rejects NOT_FOUND when no grant with that id exists",
      async () => {
        const result =
          await acceptSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: { data: null, error: null },
              },
            ),
            granteeMemberContext,
            "grant-missing" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      // 2026-08-29 (P11 finding #5, live-reproduced against local
      // Postgres): this exact CAS UPDATE used to accept a grant whose
      // expires_at had lapsed 400 days ago. The domain-level check
      // (transitionSharingGrant, grant-lifecycle.ts) now rejects
      // BEFORE any UPDATE is even attempted -- asserted here via
      // fromCalls staying empty (no db round trip for the update).
      "rejects GRANT_EXPIRED when the grant's expires_at has already lapsed, without ever attempting the UPDATE",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await acceptSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: {
                  data: { ...baseRow, expires_at: "2025-07-25T00:00:00Z" },
                  error: null,
                },
              },
              recorder,
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "GRANT_EXPIRED" },
        );

        expect(
          recorder.ops.some((op) => op.op === "update"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects GRANT_NOT_INVITED when the grant isn't INVITED",
      async () => {
        const result =
          await acceptSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: { data: { ...baseRow, status: "REVOKED" }, error: null },
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "GRANT_NOT_INVITED" },
        );
      },
    );

    it(
      "records a sharing_grant.accepted audit event on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await acceptSharingGrant(
          makeMockSupabase(
            {
              sharing_grants: { data: baseRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          granteeMemberContext,
          "grant-1" as never,
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        expect(auditOp).toBeDefined();

        expect(
          (auditOp?.payload as { event_type: string }).event_type,
        ).toBe(
          "sharing_grant.accepted",
        );
      },
    );
  },
);

describe(
  "revokeSharingGrant",
  () => {
    it(
      "revokes a grant when the caller is ADMIN of the grantor org",
      async () => {
        const result =
          await revokeSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: [
                  { data: baseRow, error: null },
                  { data: { ...baseRow, status: "REVOKED" }, error: null },
                ],
              },
            ),
            adminContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "OK", grant: expect.objectContaining({ status: "REVOKED" }) },
        );
      },
    );

    it(
      "rejects ALREADY_TERMINAL (not a silent OK) when the CAS predicate matches zero rows -- e.g. the grant reached a terminal state between fetch and update",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await revokeSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: [
                  { data: baseRow, error: null },
                  { data: null, error: null },
                ],
                audit_events: { data: null, error: null },
              },
              recorder,
            ),
            adminContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_TERMINAL" },
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects PERMISSION_DENIED for a plain MEMBER, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await revokeSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            memberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects PERMISSION_DENIED for an ADMIN of the grantee org (not the grantor)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await revokeSharingGrant(
            makeMockSupabase(
              {},
              recorder,
            ),
            granteeAdminContext,
            "grant-1" as never,
          );

        expect(result.status).toBe(
          "REJECTED",
        );
      },
    );

    it(
      "rejects NOT_FOUND when the grant's grantor_org_id doesn't match the caller's active org",
      async () => {
        const result =
          await revokeSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: { data: { ...baseRow, grantor_org_id: "org-9" }, error: null },
              },
            ),
            adminContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      "rejects ALREADY_TERMINAL when the grant is already REVOKED",
      async () => {
        const result =
          await revokeSharingGrant(
            makeMockSupabase(
              {
                sharing_grants: { data: { ...baseRow, status: "REVOKED" }, error: null },
              },
            ),
            adminContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_TERMINAL" },
        );
      },
    );

    it(
      "records a sharing_grant.revoked audit event on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await revokeSharingGrant(
          makeMockSupabase(
            {
              sharing_grants: { data: baseRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          adminContext,
          "grant-1" as never,
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        expect(auditOp).toBeDefined();

        expect(
          (auditOp?.payload as { event_type: string }).event_type,
        ).toBe(
          "sharing_grant.revoked",
        );
      },
    );
  },
);

// Bootstrap accept path (P7-D2, 20260829300000) -- unlike acceptSharingGrant
// above (a bare CAS UPDATE), this is RPC-backed
// (accept_sharing_grant_invitation(), 20260829300000) because no bare RLS
// UPDATE policy can cover "grantee_org_id resolves from null for the first
// time" -- same reasoning acceptInvitation's own RPC-mapping tests
// (src/application/organizations/invitations.test.ts) already establish
// for accept_organization_invitation.
describe(
  "acceptSharingGrantInvitation",
  () => {
    it(
      "maps OK and records a sharing_grant.accepted audit event",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {
                audit_events: { data: null, error: null },
              },
              recorder,
              {
                data: [{ result_status: "OK", result_org_id: "org-2" }],
                error: null,
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "OK", orgId: "org-2" },
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        expect(auditOp).toBeDefined();

        expect(
          (auditOp?.payload as { event_type: string }).event_type,
        ).toBe(
          "sharing_grant.accepted",
        );
      },
    );

    it(
      "maps EXPIRED and does not record an audit event",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              recorder,
              {
                data: [{ result_status: "EXPIRED", result_org_id: null }],
                error: null,
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "EXPIRED" },
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "maps EMAIL_MISMATCH -- a stranger whose authenticated email doesn't match invited_email cannot accept",
      async () => {
        const result =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              { fromCalls: [], ops: [] },
              {
                data: [{ result_status: "EMAIL_MISMATCH", result_org_id: null }],
                error: null,
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "EMAIL_MISMATCH" },
        );
      },
    );

    it(
      "maps NOT_PENDING (also covers the RPC's ALREADY_ACTIVE case -- an already-ACTIVE or REVOKED grant cannot be re-accepted)",
      async () => {
        const alreadyActive =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              { fromCalls: [], ops: [] },
              {
                data: [{ result_status: "ALREADY_ACTIVE", result_org_id: "org-2" }],
                error: null,
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(alreadyActive).toEqual(
          { status: "NOT_PENDING" },
        );

        const notPending =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              { fromCalls: [], ops: [] },
              {
                data: [{ result_status: "NOT_PENDING", result_org_id: null }],
                error: null,
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(notPending).toEqual(
          { status: "NOT_PENDING" },
        );
      },
    );

    it(
      "maps SELF_GRANT_NOT_ALLOWED",
      async () => {
        const result =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              { fromCalls: [], ops: [] },
              {
                data: [{ result_status: "SELF_GRANT_NOT_ALLOWED", result_org_id: null }],
                error: null,
              },
            ),
            adminContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "SELF_GRANT_NOT_ALLOWED" },
        );
      },
    );

    it(
      "maps NOT_A_MEMBER -- defense-in-depth against a caller-supplied org id the caller doesn't actually belong to",
      async () => {
        const result =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              { fromCalls: [], ops: [] },
              {
                data: [{ result_status: "NOT_A_MEMBER", result_org_id: null }],
                error: null,
              },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "NOT_A_MEMBER" },
        );
      },
    );

    it(
      "maps NOT_FOUND when the RPC errors",
      async () => {
        const result =
          await acceptSharingGrantInvitation(
            makeMockSupabase(
              {},
              { fromCalls: [], ops: [] },
              { data: null, error: { message: "boom" } },
            ),
            granteeMemberContext,
            "grant-1" as never,
          );

        expect(result).toEqual(
          { status: "NOT_FOUND" },
        );
      },
    );
  },
);

describe(
  "listMyPendingSharingGrantInvitations",
  () => {
    it(
      "maps rows with the resolved grantor organization name and installation name",
      async () => {
        const bootstrapRow =
          {
            ...baseRow,
            grantee_org_id: null,
            invited_email: "buyer@example.com",
          };

        const result =
          await listMyPendingSharingGrantInvitations(
            makeMockSupabase(
              {
                sharing_grants: { data: [bootstrapRow], error: null },
                organizations: { data: [{ id: "org-1", name: "Acme Steel" }], error: null },
                installations: { data: [{ id: "installation-1", name: "Plant 1" }], error: null },
              },
            ),
            "buyer@example.com",
          );

        expect(result).toEqual(
          [
            {
              grant: expect.objectContaining(
                { id: "grant-1", invited_email: "buyer@example.com" },
              ),
              grantorOrganizationName: "Acme Steel",
              installationName: "Plant 1",
            },
          ],
        );
      },
    );

    it(
      "returns an empty array on a fetch error",
      async () => {
        const result =
          await listMyPendingSharingGrantInvitations(
            makeMockSupabase(
              {
                sharing_grants: { data: null, error: { message: "denied" } },
              },
            ),
            "buyer@example.com",
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "falls back to placeholder names when the lookup rows are missing",
      async () => {
        const bootstrapRow =
          {
            ...baseRow,
            grantee_org_id: null,
            invited_email: "buyer@example.com",
          };

        const result =
          await listMyPendingSharingGrantInvitations(
            makeMockSupabase(
              {
                sharing_grants: { data: [bootstrapRow], error: null },
                organizations: { data: [], error: null },
                installations: { data: [], error: null },
              },
            ),
            "buyer@example.com",
          );

        expect(result).toEqual(
          [
            {
              grant: expect.objectContaining(
                { id: "grant-1" },
              ),
              grantorOrganizationName: "Unknown organization",
              installationName: "Unknown installation",
            },
          ],
        );
      },
    );

    it(
      "returns an empty array (never a silent 'Unknown' placeholder) when either follow-up name lookup errors -- distinguishes a genuine lookup failure from a legitimately-empty result (2026-08-29 mandatory review fix)",
      async () => {
        const bootstrapRow =
          {
            ...baseRow,
            grantee_org_id: null,
            invited_email: "buyer@example.com",
          };

        const result =
          await listMyPendingSharingGrantInvitations(
            makeMockSupabase(
              {
                sharing_grants: { data: [bootstrapRow], error: null },
                organizations: { data: null, error: { message: "statement timeout" } },
                installations: { data: [{ id: "installation-1", name: "Plant 1" }], error: null },
              },
            ),
            "buyer@example.com",
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);
