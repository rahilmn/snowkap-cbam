import {
  describe,
  expect,
  it,
} from "vitest";

import {
  recordDeclarationFiled,
} from "./record-declaration-filed";

const orgId =
  "org-1";

const adminContext =
  {
    org_id: orgId,
    user_id: "admin-1",
    role: "ADMIN",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const memberContext =
  {
    org_id: orgId,
    user_id: "member-1",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const adminNoCapabilityContext =
  {
    org_id: orgId,
    user_id: "admin-1",
    role: "ADMIN",
    capabilities: ["PRODUCER_OPERATOR"],
  } as never;

interface RpcCall {
  fnName: string;
  args: unknown;
}

// Only exercises .rpc() -- recordDeclarationFiled never touches
// .from() at all (see its own doc comment: no client-side audit
// insert, since the RPC already writes one atomically).
function makeMockSupabase(
  rpcResult: { data: unknown; error: unknown },
  calls: RpcCall[] = [],
) {
  return {
    rpc: (fnName: string, args: unknown) => {
      calls.push(
        { fnName, args },
      );

      return Promise.resolve(
        rpcResult,
      );
    },
  } as never;
}

describe(
  "recordDeclarationFiled",
  () => {
    it(
      "rejects PERMISSION_DENIED for a MEMBER, before calling the RPC at all",
      async () => {
        const calls: RpcCall[] =
          [];

        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: null, error: null },
              calls,
            ),
            memberContext,
            "decl-1" as never,
            "EU/CBAM/2026/1",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        expect(calls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects CAPABILITY_NOT_HELD for an ADMIN whose org lacks IMPORTER_DECLARANT, before calling the RPC at all",
      async () => {
        const calls: RpcCall[] =
          [];

        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: null, error: null },
              calls,
            ),
            adminNoCapabilityContext,
            "decl-1" as never,
            "EU/CBAM/2026/1",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );

        expect(calls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects EMPTY_FILED_REFERENCE for a whitespace-only reference, before calling the RPC at all",
      async () => {
        const calls: RpcCall[] =
          [];

        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: null, error: null },
              calls,
            ),
            adminContext,
            "decl-1" as never,
            "   ",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMPTY_FILED_REFERENCE" },
        );

        expect(calls).toEqual(
          [],
        );
      },
    );

    it(
      "forwards filedReference to the RPC byte-for-byte, padding intact -- never trimmed before it reaches record_declaration_filed()",
      async () => {
        const calls: RpcCall[] =
          [];

        await recordDeclarationFiled(
          makeMockSupabase(
            { data: [{ result_status: "OK", result_declaration_id: "decl-1" }], error: null },
            calls,
          ),
          adminContext,
          "decl-1" as never,
          "  EU/CBAM/2026/ab-00917  ",
        );

        expect(calls[0]?.args).toEqual(
          { p_declaration_id: "decl-1", p_filed_reference: "  EU/CBAM/2026/ab-00917  " },
        );
      },
    );

    it(
      "maps OK to the declaration id the RPC returned",
      async () => {
        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: [{ result_status: "OK", result_declaration_id: "decl-1" }], error: null },
            ),
            adminContext,
            "decl-1" as never,
            "EU/CBAM/2026/1",
          );

        expect(result).toEqual(
          { status: "OK", declarationId: "decl-1" },
        );
      },
    );

    it(
      "maps INCOMPLETE -- a fresh filing-time re-aggregation found an uncalculated member line",
      async () => {
        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: [{ result_status: "INCOMPLETE", result_declaration_id: null }], error: null },
            ),
            adminContext,
            "decl-1" as never,
            "EU/CBAM/2026/1",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INCOMPLETE" },
        );
      },
    );

    it(
      "maps ALREADY_FILED (the double-click case)",
      async () => {
        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: [{ result_status: "ALREADY_FILED", result_declaration_id: null }], error: null },
            ),
            adminContext,
            "decl-1" as never,
            "EU/CBAM/2026/1",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_FILED" },
        );
      },
    );

    it(
      "maps RPC_FAILED when the RPC call itself errors",
      async () => {
        const result =
          await recordDeclarationFiled(
            makeMockSupabase(
              { data: null, error: { message: "boom" } },
            ),
            adminContext,
            "decl-1" as never,
            "EU/CBAM/2026/1",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RPC_FAILED" },
        );
      },
    );
  },
);
