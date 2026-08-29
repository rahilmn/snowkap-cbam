import {
  createHash,
  randomUUID,
} from "node:crypto";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  validateEvidenceUpload,
  type EvidenceUploadRejectionReason,
} from "../../domain/evidence/validate-evidence-upload";

import type {
  EvidenceFile,
} from "../../domain/evidence/types";

import type {
  EmissionDataId,
  EvidenceFileId,
  OrganizationId,
} from "../../domain/shared/ids";

import {
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  EVIDENCE_FILES_COLUMNS,
  toEvidenceFile,
  type EvidenceFileRow,
} from "./evidence-mapper";

/**
 * Must match the bucket id created by
 * supabase/migrations/20260829240000_p7c_evidence_files_schema.sql's
 * `insert into storage.buckets`.
 */
export const EVIDENCE_STORAGE_BUCKET =
  "evidence";

/**
 * Short-lived, per the task's own upload-safety-minimums requirement
 * ("signed, short-lived URLs") -- 5 minutes is enough for a browser to
 * follow a redirect/open a download without the URL remaining valid
 * indefinitely if it leaks (a shared screenshot, a log line, ...).
 */
const SIGNED_URL_EXPIRES_IN_SECONDS =
  300;

interface EmissionDataOwnershipRow {
  entered_by_org_id: string;
  evidence_file_ids: string[];
}

/**
 * Mirrors manage-emission-data.ts's own fetchOwnedEmissionData /
 * verifyInstallationOwnership shape exactly (error -> PERSIST_FAILED,
 * missing-or-wrong-org -> a NOT_FOUND-style reason) rather than
 * reimplementing the ownership-check pattern from scratch -- see this
 * task's own instruction to reuse that established discipline. Also
 * returns the record's CURRENT evidence_file_ids, so callers doing a
 * read-then-write append (uploadEvidenceFile) don't need a second
 * round trip.
 */
async function fetchOwnedEmissionDataForEvidence(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<
  | { status: "OK"; evidenceFileIds: string[] }
  | { status: "REJECTED"; reason: "EMISSION_DATA_NOT_FOUND" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        "entered_by_org_id, evidence_file_ids",
      )
      .eq("id", emissionDataId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const row =
    data as EmissionDataOwnershipRow | null;

  if (!row || row.entered_by_org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "EMISSION_DATA_NOT_FOUND",
    };
  }

  return {
    status: "OK",
    evidenceFileIds: row.evidence_file_ids ?? [],
  };
}

/**
 * Mirrors manage-emission-data.ts's own fetchOwnedEmissionData shape
 * (a query error and a missing-or-wrong-org row are distinct reasons)
 * for the evidence_files table -- used by both removeEvidenceFile and
 * getEvidenceDownloadUrl so an evidence file belonging to a different
 * org is never even revealed to exist to the caller (NOT_FOUND, not a
 * more specific "belongs to another org" reason -- same posture as
 * every other ownership check in this codebase).
 */
async function fetchOwnedEvidenceFile(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  evidenceFileId: EvidenceFileId,
): Promise<
  | { status: "OK"; file: EvidenceFile }
  | { status: "REJECTED"; reason: "NOT_FOUND" | "FETCH_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("evidence_files")
      .select(
        EVIDENCE_FILES_COLUMNS,
      )
      .eq("id", evidenceFileId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const row =
    data as EvidenceFileRow | null;

  if (!row || row.org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  return {
    status: "OK",
    file: toEvidenceFile(row),
  };
}

/**
 * Strips any directory components from a client-supplied filename
 * before it is stored as `original_filename` (display metadata only
 * -- the actual storage object name is always server-generated, see
 * uploadEvidenceFile below, so this sanitization is defense in depth
 * against a filename like "../../etc/passwd.pdf" being stored/rendered
 * verbatim, not a path-traversal vector in itself).
 */
function sanitizeOriginalFilename(
  fileName: string,
): string {
  const withoutDirectories =
    fileName.replace(
      /^.*[\\/]/,
      "",
    );

  const trimmed =
    withoutDirectories.trim();

  return trimmed.length > 0
    ? trimmed
    : "file";
}

export interface UploadEvidenceInput {
  emissionDataId: EmissionDataId;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
}

export type UploadEvidenceResult =
  | { status: "OK"; file: EvidenceFile }
  | {
      status: "REJECTED";
      reason:
        | "EMISSION_DATA_NOT_FOUND"
        | EvidenceUploadRejectionReason
        | "UPLOAD_FAILED"
        | "PERSIST_FAILED"
        // The caller's org doesn't hold PRODUCER_OPERATOR -- evidence for
        // emission data is a producer-only workflow (master plan §6/§14).
        // Checked BEFORE any database read, same posture as every
        // hasAdminAccess gate elsewhere in this codebase (P10/P11
        // capability-matrix hardening pass -- see
        // docs/architecture/AUTHORIZATION_MATRIX.md's "Capability
        // enforcement" section).
        | "CAPABILITY_NOT_HELD";
    };

/**
 * Uploads one evidence file for an emission_data record the caller's
 * active org owns. Order of operations, and why:
 *
 *   1. Ownership check FIRST (fetchOwnedEmissionDataForEvidence) --
 *      never touch storage or validate a file's content for a record
 *      the caller doesn't own; also gives the CURRENT evidence_file_ids
 *      to append onto later without a second read.
 *   2. Pure validation SECOND (validateEvidenceUpload) -- MIME/
 *      extension/size/executable checks, all before any I/O, so a
 *      rejected upload never reaches storage.
 *   3. sha256 computed server-side from the actual bytes (Node's
 *      crypto, never a client-supplied hash) -- see this module's own
 *      header note in validate-evidence-upload.ts.
 *   4. Upload to the org-scoped storage path using the CALLER'S
 *      user-scoped `supabase` client (never a service-role client),
 *      so storage.objects RLS
 *      (20260829240000_p7c_evidence_files_schema.sql) is genuinely
 *      exercised on every upload, not bypassed.
 *   5. Insert the evidence_files metadata row.
 *   6. Append the new file's id onto emission_data.evidence_file_ids
 *      (read-then-write, using the array read in step 1).
 *   7. Audit event.
 *
 * Steps 4-6 are three separate statements with no cross-statement
 * transaction (this codebase has no such mechanism for plain
 * application-layer services -- see record-audit-event.ts's and
 * manage-emission-data.ts's activateEmissionData's own doc comments on
 * the same limitation). A failure at step 5 or 6 triggers a best-effort
 * compensating cleanup of whatever was already created in the earlier
 * step(s), rather than leaving an evidence_files row that
 * emission_data.evidence_file_ids doesn't reference (which would be
 * silently invisible to every domain read of that array, e.g.
 * src/domain/emissions/snapshot-completeness.ts) or a storage object
 * with no metadata row at all.
 */
export async function uploadEvidenceFile(
  supabase: SupabaseClient,
  context: OrgContext,
  input: UploadEvidenceInput,
): Promise<UploadEvidenceResult> {
  if (!hasCapability(context, "PRODUCER_OPERATOR")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const ownership =
    await fetchOwnedEmissionDataForEvidence(
      supabase,
      orgId,
      input.emissionDataId,
    );

  if (ownership.status === "REJECTED") {
    return ownership;
  }

  const validation =
    validateEvidenceUpload(
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        // Always the length of the bytes actually received, never a
        // client-reported size -- same "don't trust the client"
        // posture as the sha256 below.
        sizeBytes: input.fileBytes.byteLength,
      },
    );

  if (validation.status === "REJECTED") {
    return validation;
  }

  const sha256 =
    createHash("sha256")
      .update(input.fileBytes)
      .digest("hex");

  // {org_id}/{emission_data_id}/{random-uuid}{extension} -- the
  // filename segment is server-generated, not the client-supplied
  // name, so weird characters/collisions/path-traversal attempts in a
  // client filename can never affect the actual object path. The
  // client's original name is preserved separately as display
  // metadata (original_filename, sanitized above).
  const storagePath =
    `${orgId}/${input.emissionDataId}/${randomUUID()}${validation.extension}`;

  const { error: uploadError } =
    await supabase.storage
      .from(EVIDENCE_STORAGE_BUCKET)
      .upload(
        storagePath,
        input.fileBytes,
        {
          contentType: input.mimeType,
          upsert: false,
        },
      );

  if (uploadError) {
    return {
      status: "REJECTED",
      reason: "UPLOAD_FAILED",
    };
  }

  const { data: insertedRow, error: insertError } =
    await supabase
      .from("evidence_files")
      .insert(
        {
          org_id: orgId,
          emission_data_id: input.emissionDataId,
          storage_path: storagePath,
          original_filename: sanitizeOriginalFilename(input.fileName),
          mime_type: input.mimeType,
          size_bytes: input.fileBytes.byteLength,
          sha256,
          uploaded_by_user_id: actorUserId,
        },
      )
      .select(
        EVIDENCE_FILES_COLUMNS,
      )
      .single();

  if (insertError || !insertedRow) {
    // Nothing else references this object yet -- safe to remove
    // outright. Best-effort: its own failure is not itself surfaced,
    // matching record-audit-event.ts's documented "best-effort by
    // design" posture for compensating actions in this codebase.
    await supabase.storage
      .from(EVIDENCE_STORAGE_BUCKET)
      .remove(
        [storagePath],
      );

    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const file =
    toEvidenceFile(
      insertedRow as EvidenceFileRow,
    );

  const { error: arrayUpdateError } =
    await supabase
      .from("emission_data")
      .update(
        {
          evidence_file_ids: [...ownership.evidenceFileIds, file.id],
        },
      )
      .eq("id", input.emissionDataId);

  if (arrayUpdateError) {
    // Compensate: delete the just-created metadata row and object
    // rather than leave an evidence_files row that emission_data.
    // evidence_file_ids doesn't reference -- see this function's own
    // doc comment. Best-effort; either compensating call's own
    // failure is not itself surfaced.
    await supabase
      .from("evidence_files")
      .delete()
      .eq("id", file.id);

    await supabase.storage
      .from(EVIDENCE_STORAGE_BUCKET)
      .remove(
        [storagePath],
      );

    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "evidence.uploaded",
      aggregateType: "EVIDENCE_FILE",
      aggregateId: file.id,
      payload: {
        emission_data_id: input.emissionDataId,
        original_filename: file.original_filename,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
      },
    },
  );

  return {
    status: "OK",
    file,
  };
}

export type RemoveEvidenceFileResult =
  | { status: "OK" }
  | {
      status: "REJECTED";
      reason:
        | "NOT_FOUND"
        | "FETCH_FAILED"
        | "STORAGE_DELETE_FAILED"
        | "PERSIST_FAILED"
        | "CAPABILITY_NOT_HELD";
    };

/**
 * Removes one evidence file the caller's active org owns: the storage
 * object, the evidence_files metadata row, and this file's id out of
 * its emission_data record's evidence_file_ids array -- audited as
 * evidence.removed.
 *
 * Storage delete runs BEFORE the metadata delete, and a storage-delete
 * failure stops here (nothing else is touched): the safer failure mode
 * is "both still exist, retryable" rather than "metadata gone but a
 * storage object now orphaned with no owning row." The
 * evidence_file_ids array update is best-effort after the metadata row
 * is already gone (same non-atomicity posture documented on
 * uploadEvidenceFile above) -- if it fails, the id is left in the
 * array pointing at a now-nonexistent evidence_files row; this is a
 * known, documented gap (not silently assumed away), and is no worse
 * than any other single-statement failure in this codebase's own
 * activateEmissionData (its own doc comment names the identical
 * limitation for its two-row supersede-then-activate sequence).
 */
export async function removeEvidenceFile(
  supabase: SupabaseClient,
  context: OrgContext,
  evidenceFileId: EvidenceFileId,
): Promise<RemoveEvidenceFileResult> {
  if (!hasCapability(context, "PRODUCER_OPERATOR")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const fetched =
    await fetchOwnedEvidenceFile(
      supabase,
      orgId,
      evidenceFileId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  const { error: storageError } =
    await supabase.storage
      .from(EVIDENCE_STORAGE_BUCKET)
      .remove(
        [fetched.file.storage_path],
      );

  if (storageError) {
    return {
      status: "REJECTED",
      reason: "STORAGE_DELETE_FAILED",
    };
  }

  const { error: deleteError } =
    await supabase
      .from("evidence_files")
      .delete()
      .eq("id", evidenceFileId);

  if (deleteError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const ownership =
    await fetchOwnedEmissionDataForEvidence(
      supabase,
      orgId,
      fetched.file.emission_data_id,
    );

  if (ownership.status === "OK") {
    await supabase
      .from("emission_data")
      .update(
        {
          evidence_file_ids: ownership.evidenceFileIds.filter(
            (id) => id !== evidenceFileId,
          ),
        },
      )
      .eq("id", fetched.file.emission_data_id);
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "evidence.removed",
      aggregateType: "EVIDENCE_FILE",
      aggregateId: evidenceFileId,
      payload: {
        emission_data_id: fetched.file.emission_data_id,
        storage_path: fetched.file.storage_path,
      },
    },
  );

  return {
    status: "OK",
  };
}

export type GetEvidenceDownloadUrlResult =
  | { status: "OK"; signedUrl: string; originalFilename: string }
  | { status: "REJECTED"; reason: "NOT_FOUND" | "FETCH_FAILED" | "SIGNING_FAILED" };

/**
 * Generates a short-lived signed download URL for one evidence file
 * the caller's active org owns -- ownership is checked BEFORE
 * generating any URL, so a caller can never obtain a signed URL for a
 * file belonging to a different org (the point of this check existing
 * at all, since a signed URL itself carries no further authorization
 * once issued).
 */
export async function getEvidenceDownloadUrl(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  evidenceFileId: EvidenceFileId,
): Promise<GetEvidenceDownloadUrlResult> {
  const fetched =
    await fetchOwnedEvidenceFile(
      supabase,
      orgId,
      evidenceFileId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  const { data, error } =
    await supabase.storage
      .from(EVIDENCE_STORAGE_BUCKET)
      .createSignedUrl(
        fetched.file.storage_path,
        SIGNED_URL_EXPIRES_IN_SECONDS,
      );

  if (error || !data?.signedUrl) {
    return {
      status: "REJECTED",
      reason: "SIGNING_FAILED",
    };
  }

  return {
    status: "OK",
    signedUrl: data.signedUrl,
    originalFilename: fetched.file.original_filename,
  };
}

/**
 * All evidence files belonging to the caller's active org, newest
 * first -- mirrors manage-emission-data.ts's own listEmissionData
 * shape exactly (empty array, not a thrown error, on a fetch failure).
 * The UI groups these by emission_data_id client-side rather than this
 * function taking an emissionDataId filter, so one screen render needs
 * one query instead of one per record.
 */
export async function listEvidenceFiles(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<EvidenceFile[]> {
  const { data, error } =
    await supabase
      .from("evidence_files")
      .select(
        EVIDENCE_FILES_COLUMNS,
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as EvidenceFileRow[]).map(
    toEvidenceFile,
  );
}
