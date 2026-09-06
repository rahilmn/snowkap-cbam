import {
  createHash,
} from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MAX_EVIDENCE_FILE_SIZE_BYTES,
} from "../../domain/evidence/validate-evidence-upload";

import {
  getEvidenceDownloadUrl,
  listEvidenceFiles,
  removeEvidenceFile,
  uploadEvidenceFile,
} from "./upload-evidence";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

function memberContext(
  capabilities: OrgContext["capabilities"] = ["PRODUCER_OPERATOR"],
): OrgContext {
  return {
    org_id: orgId,
    user_id: actorUserId,
    role: "MEMBER",
    capabilities,
  };
}

const emissionDataId =
  "emission-data-1" as never;

const evidenceFileRow =
  {
    id: "evidence-file-1",
    org_id: "org-1",
    emission_data_id: "emission-data-1",
    storage_path: "org-1/emission-data-1/generated-name.pdf",
    original_filename: "test-report.pdf",
    mime_type: "application/pdf",
    size_bytes: 11,
    sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde",
    uploaded_by_user_id: "user-1",
    created_at: "2026-01-01T00:00:00Z",
  };

interface Op {
  table: string;
  op: "insert" | "update" | "delete";
  payload: unknown;
  filters: [string, unknown][];
}

interface StorageOp {
  op: "upload" | "remove" | "createSignedUrl";
  bucket: string;
  path?: string;
  paths?: string[];
  bytes?: Uint8Array;
}

interface RpcCall {
  fn: string;
  params: unknown;
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
  storageOps: StorageOp[];
  rpcCalls: RpcCall[];
}

function makeRecorder(): Recorder {
  return {
    fromCalls: [],
    ops: [],
    storageOps: [],
    rpcCalls: [],
  };
}

interface StorageConfig {
  uploadError?: { message: string } | null;
  removeError?: { message: string } | null;
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
}

// 2026-09-06 (S5 cross-phase hardening). uploadEvidenceFile/
// removeEvidenceFile now mutate emission_data.evidence_file_ids via the
// atomic append_evidence_file_id/remove_evidence_file_id RPCs
// (20260906240000) instead of a client-side read-then-write -- keyed
// by function name here, defaulting to a clean {data: null, error:
// null}, matching this file's own error/no-op default for an unlisted
// table.
interface RpcConfig {
  [fnName: string]: { data?: unknown; error: unknown } | undefined;
}

/**
 * Same generic chainable table mock as manage-emission-data.test.ts
 * (see that file's own doc comment for the reasoning) plus a fake
 * `.storage.from(bucket)` -- upload-evidence.ts is the first module
 * that needs storage I/O mocked alongside table I/O, so the storage
 * half is new here, not copied from precedent.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>,
  storageConfig: StorageConfig = {},
  recorder: Recorder = makeRecorder(),
  rpcConfig: RpcConfig = {},
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
    rpc: (fn: string, params: unknown) => {
      recorder.rpcCalls.push({ fn, params });
      const configured =
        rpcConfig[fn];

      return Promise.resolve(
        configured ?? { data: null, error: null },
      );
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array) => {
          recorder.storageOps.push({ op: "upload", bucket, path, bytes });
          return Promise.resolve(
            storageConfig.uploadError
              ? { data: null, error: storageConfig.uploadError }
              : { data: { path }, error: null },
          );
        },
        remove: (paths: string[]) => {
          recorder.storageOps.push({ op: "remove", bucket, paths });
          return Promise.resolve(
            storageConfig.removeError
              ? { data: null, error: storageConfig.removeError }
              : { data: paths, error: null },
          );
        },
        createSignedUrl: (path: string) => {
          recorder.storageOps.push({ op: "createSignedUrl", bucket, path });
          return Promise.resolve(
            storageConfig.signedUrlError
              ? { data: null, error: storageConfig.signedUrlError }
              : { data: { signedUrl: storageConfig.signedUrl ?? "https://signed.example/evidence/x" }, error: null },
          );
        },
      }),
    },
  } as never;
}

describe(
  "uploadEvidenceFile",
  () => {
    const validInput = {
      emissionDataId,
      fileName: "test-report.pdf",
      mimeType: "application/pdf",
      fileBytes: new TextEncoder().encode("hello world"),
    };

    it(
      "uploads to the org-scoped path, inserts metadata, appends the file id to evidence_file_ids, and records an audit event",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
                evidence_files: { data: evidenceFileRow, error: null },
                audit_events: { data: null, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            validInput,
          );

        expect(result).toEqual(
          { status: "OK", file: expect.objectContaining({ id: "evidence-file-1", original_filename: "test-report.pdf" }) },
        );

        const uploadOp =
          recorder.storageOps.find(
            (op) => op.op === "upload",
          );

        expect(uploadOp?.bucket).toBe(
          "evidence",
        );

        expect(uploadOp?.path).toMatch(
          /^org-1\/emission-data-1\/.+\.pdf$/,
        );

        const appendCall =
          recorder.rpcCalls.find(
            (call) => call.fn === "append_evidence_file_id",
          );

        expect(
          (appendCall?.params as { p_evidence_file_id: string })?.p_evidence_file_id,
        ).toBe(
          "evidence-file-1",
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events" && op.op === "insert"),
        ).toBe(
          true,
        );
      },
    );

    it(
      "computes sha256 server-side from the actual file bytes, never trusting a client-supplied value",
      async () => {
        const recorder =
          makeRecorder();

        await uploadEvidenceFile(
          makeMockSupabase(
            {
              emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
              evidence_files: { data: evidenceFileRow, error: null },
              audit_events: { data: null, error: null },
            },
            {},
            recorder,
          ),
          memberContext(),
          validInput,
        );

        const expectedSha256 =
          createHash("sha256")
            .update(validInput.fileBytes)
            .digest("hex");

        const insertOp =
          recorder.ops.find(
            (op) => op.table === "evidence_files" && op.op === "insert",
          );

        expect(
          (insertOp?.payload as { sha256: string }).sha256,
        ).toBe(
          expectedSha256,
        );

        expect(
          (insertOp?.payload as { size_bytes: number }).size_bytes,
        ).toBe(
          validInput.fileBytes.byteLength,
        );
      },
    );

    it(
      "appends via the atomic RPC (never a client-computed whole-array overwrite) -- the id it appends is unaffected by whatever else the array already holds",
      async () => {
        const recorder =
          makeRecorder();

        await uploadEvidenceFile(
          makeMockSupabase(
            {
              emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: ["existing-file"] }, error: null },
              evidence_files: { data: evidenceFileRow, error: null },
              audit_events: { data: null, error: null },
            },
            {},
            recorder,
          ),
          memberContext(),
          validInput,
        );

        const appendCall =
          recorder.rpcCalls.find(
            (call) => call.fn === "append_evidence_file_id",
          );

        expect(
          (appendCall?.params as { p_emission_data_id: string; p_evidence_file_id: string })?.p_emission_data_id,
        ).toBe(
          "emission-data-1",
        );

        expect(
          (appendCall?.params as { p_emission_data_id: string; p_evidence_file_id: string })?.p_evidence_file_id,
        ).toBe(
          "evidence-file-1",
        );

        // No client-side read-then-write: the pre-existing array is
        // never sent back to the server, only the one id to append.
        expect(
          recorder.ops.some((op) => op.table === "emission_data" && op.op === "update"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects EMISSION_DATA_NOT_FOUND when the emission_data record belongs to a different org, without touching storage",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-2", evidence_file_ids: [] }, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_NOT_FOUND" },
        );

        expect(recorder.storageOps).toEqual(
          [],
        );
      },
    );

    it(
      "rejects a disallowed MIME type before touching storage or the database",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            { ...validInput, mimeType: "text/plain", fileName: "notes.txt" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DISALLOWED_MIME_TYPE" },
        );

        expect(recorder.storageOps).toEqual(
          [],
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects EXECUTABLE_EXTENSION for a spoofed-MIME executable, before touching storage",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            { ...validInput, mimeType: "application/pdf", fileName: "payload.exe" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EXECUTABLE_EXTENSION" },
        );

        expect(recorder.storageOps).toEqual(
          [],
        );
      },
    );

    it(
      "rejects FILE_TOO_LARGE for a file over the 20MB cap, before touching storage",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            { ...validInput, fileBytes: new Uint8Array(MAX_EVIDENCE_FILE_SIZE_BYTES + 1) },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "FILE_TOO_LARGE" },
        );

        expect(recorder.storageOps).toEqual(
          [],
        );
      },
    );

    it(
      "reports UPLOAD_FAILED when the storage upload errors, without inserting a metadata row",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
              },
              { uploadError: { message: "storage denied" } },
              recorder,
            ),
            memberContext(),
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "UPLOAD_FAILED" },
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "reports PERSIST_FAILED and removes the uploaded object when the metadata insert fails",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
                evidence_files: { data: null, error: { message: "denied" } },
              },
              {},
              recorder,
            ),
            memberContext(),
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        expect(
          recorder.storageOps.some((op) => op.op === "remove"),
        ).toBe(
          true,
        );
      },
    );

    it(
      "reports PERSIST_FAILED and compensates (deletes the row and the object) when the evidence_file_ids array update fails",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await uploadEvidenceFile(
            makeMockSupabase(
              {
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
                evidence_files: { data: evidenceFileRow, error: null },
              },
              {},
              recorder,
              { append_evidence_file_id: { data: null, error: { message: "denied" } } },
            ),
            memberContext(),
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files" && op.op === "delete"),
        ).toBe(
          true,
        );

        expect(
          recorder.storageOps.some((op) => op.op === "remove"),
        ).toBe(
          true,
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without PRODUCER_OPERATOR with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const recorder =
              makeRecorder();

            const result =
              await uploadEvidenceFile(
                makeMockSupabase(
                  {},
                  {},
                  recorder,
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                validInput,
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );

            expect(recorder.fromCalls).toEqual(
              [],
            );
          },
        );

        it(
          "allows an org holding PRODUCER_OPERATOR",
          async () => {
            const result =
              await uploadEvidenceFile(
                makeMockSupabase(
                  {
                    emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: [] }, error: null },
                    evidence_files: { data: evidenceFileRow, error: null },
                    audit_events: { data: null, error: null },
                  },
                ),
                memberContext(["PRODUCER_OPERATOR"]),
                validInput,
              );

            expect(result.status).toBe(
              "OK",
            );
          },
        );
      },
    );
  },
);

describe(
  "removeEvidenceFile",
  () => {
    it(
      "removes the storage object, deletes the metadata row, updates evidence_file_ids, and records an audit event",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1", "other"] }, error: null },
                audit_events: { data: null, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );

        expect(
          recorder.storageOps.some((op) => op.op === "remove" && op.paths?.includes(evidenceFileRow.storage_path)),
        ).toBe(
          true,
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files" && op.op === "delete"),
        ).toBe(
          true,
        );

        const removeCall =
          recorder.rpcCalls.find(
            (call) => call.fn === "remove_evidence_file_id",
          );

        expect(
          (removeCall?.params as { p_evidence_file_id: string })?.p_evidence_file_id,
        ).toBe(
          "evidence-file-1",
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events" && op.op === "insert"),
        ).toBe(
          true,
        );
      },
    );

    it(
      "S5 cross-phase hardening: mutates evidence_file_ids via the atomic remove_evidence_file_id RPC -- no client-side read-then-write, and so no retry logic is needed even when the RPC itself reports an error (its own failure is best-effort, matching this function's established non-atomicity posture for the array step specifically)",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
                emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1", "other"] }, error: null },
                audit_events: { data: null, error: null },
              },
              {},
              recorder,
              { remove_evidence_file_id: { data: null, error: { message: "denied" } } },
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        // The metadata row and storage object are already genuinely
        // removed by this point -- a failure on the best-effort array
        // step does not turn the overall removal into a failure.
        expect(result).toEqual(
          { status: "OK" },
        );

        expect(
          recorder.rpcCalls.filter((call) => call.fn === "remove_evidence_file_id"),
        ).toHaveLength(
          1,
        );

        // No client-side read-then-write fallback: the RPC is called
        // exactly once, never retried, and no `emission_data` table
        // UPDATE is ever issued directly.
        expect(
          recorder.ops.some((op) => op.table === "emission_data" && op.op === "update"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "fails CLOSED when the owning emission_data read errors -- it must not delete evidence it could not confirm is unlocked",
      async () => {
        // 2026-08-31 (P13 final round). removeEvidenceFile read the
        // owning record only to ask "is it VERIFIED?", via
        //   if (ownership.status === "OK" && ...VERIFIED) reject
        // so when that read ERRORED the conjunct was false, the guard
        // was skipped, and the delete proceeded. The VERIFIED lock is
        // an integrity lock -- evidence behind a completed verification
        // must not be destroyable -- and a transient query error is
        // exactly when it must hold, not release.
        //
        // uploadEvidenceFile, against the same helper in this same
        // file, already fails closed (`if (ownership.status ===
        // "REJECTED") return ownership;`). Only the removal path
        // diverged.
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
                emission_data: [
                  { data: null, error: { message: "canceling statement due to statement timeout" } },
                ],
              },
              {},
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        // The point of the fix: nothing was destroyed.
        expect(recorder.storageOps).toEqual(
          [],
        );

        expect(
          recorder.ops.filter(
            (op) => op.table === "evidence_files" && op.op === "delete",
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "does not report OK when RLS silently filters the metadata DELETE to zero rows",
      async () => {
        // 2026-08-31 (P13 final round). PostgREST returns NO error for a
        // DELETE that RLS filters to zero rows, so `deleteError` was
        // null and the function reported OK for a row it never deleted.
        // evidence_files_delete_own_org (20260829560000) filters exactly
        // that way when the parent is VERIFIED.
        //
        // Composed with the fail-open above this was a data-destruction
        // bug: storage's own delete policy has NO verification clause,
        // so the object was permanently removed while the row survived
        // pointing at it, and the caller was told it worked.
        //
        // manage-membership.ts:236-243 already carries the fix pattern
        // (.select("id") + zero-rows guard) for exactly this hazard.
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: [
                  { data: evidenceFileRow, error: null },
                  // The DELETE: no error, and no rows.
                  { data: [], error: null },
                ],
                emission_data: [
                  { data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1"] }, error: null },
                ],
              },
              {},
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "rejects NOT_FOUND when the file belongs to a different org, without touching storage",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: { ...evidenceFileRow, org_id: "org-2" }, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );

        expect(recorder.storageOps).toEqual(
          [],
        );
      },
    );

    it(
      "reports STORAGE_DELETE_FAILED and leaves the metadata row intact when the storage delete fails",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
                // Fixture completed 2026-08-31: this case never modelled
                // the owning-record read, and so was reaching the storage
                // step only because removeEvidenceFile used to fail OPEN
                // on that read. Now that it fails closed, the fixture has
                // to describe what actually happens in this scenario -- a
                // successful, non-VERIFIED ownership read, followed by a
                // storage failure. The assertions below are unchanged.
                emission_data: [
                  { data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1"] }, error: null },
                ],
              },
              { removeError: { message: "storage denied" } },
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "STORAGE_DELETE_FAILED" },
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files" && op.op === "delete"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects EMISSION_DATA_VERIFIED and touches neither storage nor the metadata row when the owning emission_data record is VERIFIED -- once a verifier has signed off on an evidence set (DRAFT+VERIFIED, ACTIVE, or SUPERSEDED all carry verification_status VERIFIED), it must stay intact so the verifier's decision remains provable and an already-consumable/consumed record's basis can never be silently altered",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
                emission_data: {
                  data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1"], verification_status: "VERIFIED" },
                  error: null,
                },
              },
              {},
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_VERIFIED" },
        );

        expect(recorder.storageOps).toEqual(
          [],
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files" && op.op === "delete"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "allows removal when the owning emission_data record is DRAFT + REJECTED (a producer fixing evidence before resubmitting) -- verification_status other than VERIFIED must never block removal",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await removeEvidenceFile(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
                emission_data: {
                  data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1", "other"], verification_status: "REJECTED" },
                  error: null,
                },
                audit_events: { data: null, error: null },
              },
              {},
              recorder,
            ),
            memberContext(),
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );

        expect(
          recorder.ops.some((op) => op.table === "evidence_files" && op.op === "delete"),
        ).toBe(
          true,
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without PRODUCER_OPERATOR with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const recorder =
              makeRecorder();

            const result =
              await removeEvidenceFile(
                makeMockSupabase(
                  {},
                  {},
                  recorder,
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                "evidence-file-1" as never,
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );

            expect(recorder.fromCalls).toEqual(
              [],
            );
          },
        );

        it(
          "allows an org holding PRODUCER_OPERATOR",
          async () => {
            const result =
              await removeEvidenceFile(
                makeMockSupabase(
                  {
                    evidence_files: { data: evidenceFileRow, error: null },
                    emission_data: { data: { entered_by_org_id: "org-1", evidence_file_ids: ["evidence-file-1"] }, error: null },
                  },
                ),
                memberContext(["PRODUCER_OPERATOR"]),
                "evidence-file-1" as never,
              );

            expect(result).toEqual(
              { status: "OK" },
            );
          },
        );
      },
    );
  },
);

describe(
  "getEvidenceDownloadUrl",
  () => {
    it(
      "returns a signed URL for an owned file",
      async () => {
        const result =
          await getEvidenceDownloadUrl(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
              },
              { signedUrl: "https://signed.example/evidence/one" },
            ),
            orgId,
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "OK", signedUrl: "https://signed.example/evidence/one", originalFilename: "test-report.pdf" },
        );
      },
    );

    it(
      "rejects NOT_FOUND for a file belonging to a different org, without generating a signed URL",
      async () => {
        const recorder =
          makeRecorder();

        const result =
          await getEvidenceDownloadUrl(
            makeMockSupabase(
              {
                evidence_files: { data: { ...evidenceFileRow, org_id: "org-2" }, error: null },
              },
              {},
              recorder,
            ),
            orgId,
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );

        expect(
          recorder.storageOps.some((op) => op.op === "createSignedUrl"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects SIGNING_FAILED when signed URL generation errors",
      async () => {
        const result =
          await getEvidenceDownloadUrl(
            makeMockSupabase(
              {
                evidence_files: { data: evidenceFileRow, error: null },
              },
              { signedUrlError: { message: "denied" } },
            ),
            orgId,
            "evidence-file-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SIGNING_FAILED" },
        );
      },
    );
  },
);

describe(
  "listEvidenceFiles",
  () => {
    it(
      "maps rows to EvidenceFile objects for the org",
      async () => {
        const result =
          await listEvidenceFiles(
            makeMockSupabase(
              { evidence_files: { data: [evidenceFileRow], error: null } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              { id: "evidence-file-1", original_filename: "test-report.pdf" },
            ),
          ],
        );
      },
    );

    it(
      "returns an empty array on a fetch error",
      async () => {
        const result =
          await listEvidenceFiles(
            makeMockSupabase(
              { evidence_files: { data: null, error: { message: "denied" } } },
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
