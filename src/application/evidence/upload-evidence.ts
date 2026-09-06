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

import type {
  OrgContext,
} from "../organizations/org-context";

import {
  mayManageOwnInstallationRecords,
} from "../installations/provenance-capability";

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
  verification_status: string;
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
  | { status: "OK"; evidenceFileIds: string[]; verificationStatus: string }
  | { status: "REJECTED"; reason: "EMISSION_DATA_NOT_FOUND" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        "entered_by_org_id, evidence_file_ids, verification_status",
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
    verificationStatus: row.verification_status,
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
  // 2026-09-06 (S5 review remediation round 2, finding S5R2-COMPOSE-B1).
  // Was PRODUCER_OPERATOR-only, but owner decision D2 gives an
  // IMPORTER_DECLARANT-only org a first-class emissions-capture path
  // too (/external-emissions, IMPORTER_ENTERED provenance) -- every
  // OTHER emission_data operation (record/submit/verify/reject/discard/
  // activate, manage-emission-data.ts) already gates on
  // mayManageOwnInstallationRecords (PRODUCER_OPERATOR OR
  // IMPORTER_DECLARANT). Evidence was the one operation still gated on
  // PRODUCER_OPERATOR alone, so an importer-only org could create a
  // record but never attach evidence to it -- and since
  // checkEmissionDataEvidenceCompleteness requires evidence_file_ids
  // non-empty with no provenance waiver, that record could never be
  // verified or activated at all. This round's own guidance fix
  // (020c2b3) now actively routes importer-only orgs to /external-
  // emissions to fix a REJECTED record, which makes this dead end
  // routinely reachable.
  if (!mayManageOwnInstallationRecords(context)) {
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

  // 2026-09-06 (S5 cross-phase hardening). Was a client-side read
  // (step 1's ownership.evidenceFileIds) + write of a whole new array
  // -- two concurrent writers (this call and a concurrent
  // removeEvidenceFile) could each read the SAME baseline before
  // either wrote, and the second writer's own write would silently
  // overwrite the first's, live-reproduced end to end. append_evidence_
  // file_id (20260906240000) performs this as a single atomic
  // `array_append` UPDATE, so two concurrent calls against the same
  // row serialize at the row level instead of racing -- SECURITY
  // INVOKER, so RLS (including the evidence_file_ids anti-join) still
  // governs this write exactly as it did the bare UPDATE it replaces.
  const { error: arrayUpdateError } =
    await supabase
      .rpc(
        "append_evidence_file_id",
        {
          p_emission_data_id: input.emissionDataId,
          p_evidence_file_id: file.id,
        },
      );

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
        | "PERSIST_FAILED"
        | "CAPABILITY_NOT_HELD"
        | "EMISSION_DATA_VERIFIED";
    };

/**
 * Removes one evidence file the caller's active org owns: this file's
 * id out of its emission_data record's evidence_file_ids array, the
 * storage object, then the evidence_files metadata row -- audited as
 * evidence.removed.
 *
 * Rejects EMISSION_DATA_VERIFIED before touching anything if the owning
 * emission_data record's verification_status is VERIFIED (P13 review,
 * finding S6, live-reproduced: nothing previously stopped a plain
 * PRODUCER_OPERATOR member from deleting evidence out from under a
 * DRAFT+VERIFIED, ACTIVE, or SUPERSEDED record -- all three carry
 * verification_status VERIFIED, since ACTIVATE only flips `status` and
 * superseding never touches verification_status -- silently
 * invalidating the verifier's own basis for having approved it, for a
 * record that may already be consumed cross-org via a sharing grant).
 * Deliberately keyed on verification_status alone, not `status`: a
 * DRAFT+REJECTED record (verification_status REJECTED) must remain
 * editable so a producer can fix its evidence and resubmit
 * (emission-data-lifecycle.ts's own SUBMIT_FOR_VERIFICATION transition
 * accepts REJECTED as a valid prior state) -- gating on `status`
 * (DRAFT vs ACTIVE) alone would have also blocked a DRAFT+VERIFIED
 * record sitting unactivated, which is exactly the moment a producer
 * could otherwise strip evidence the verifier already signed off on
 * and then ACTIVATE anyway.
 *
 * 2026-09-07 (S5 review round 4, finding S5R4-AUTHZ-B1). The
 * evidence_file_ids array update (remove_evidence_file_id,
 * 20260906240000) now runs FIRST, before either delete, rather than
 * best-effort after the metadata delete. Each individual RLS/trigger
 * check that guards this record (the in-memory verificationStatus
 * check above, evidence_storage_delete_own_org, evidence_files_
 * delete_own_org) was already independently correct in isolation --
 * this was a gap BETWEEN them: a concurrent, fully legitimate ADMIN
 * VERIFY landing between the OLD ordering's storage delete and
 * metadata delete left the storage bytes permanently deleted (a
 * genuinely authorized delete at the instant it ran, while the record
 * was still not-VERIFIED) while the metadata delete then correctly
 * refused (the record had since become VERIFIED) -- an
 * "evidence can never shrink" VERIFIED record whose evidence_files row
 * and citation stayed intact, but whose actual object no longer
 * existed in storage. Live-reproduced end to end (real psql BEGIN...
 * ROLLBACK, impersonating a real MEMBER and a real ADMIN of the same
 * org): the ordering race reproduced exactly as described.
 *
 * remove_evidence_file_id's own UPDATE is the one write in this whole
 * function already hardened to be un-race-able against a concurrent
 * VERIFY (S5R3-AUTHZ-B1, this same phase): app.enforce_emission_data_
 * verification_gate's "evidence cannot shrink from a VERIFIED record,
 * in any status" rule fires live, inside that single UPDATE statement,
 * against whatever the row's verification_status genuinely is at that
 * instant -- so running it FIRST, and treating any error it returns as
 * EMISSION_DATA_VERIFIED, makes it the authoritative gate the storage
 * and metadata deletes that follow can safely rely on having already
 * passed. If it fails, nothing else is touched. If it succeeds, the
 * array has already, atomically, and permanently recorded that this id
 * no longer counts as backing evidence -- a VERIFY that commits any
 * time after this point changes nothing about that fact, so the
 * storage/metadata cleanup that follows is just carrying out an
 * already-safely-decided removal, never racing to decide one.
 *
 * 2026-09-07 (S5 review round 5, finding S5R5-AUTHZ-Y2). The metadata
 * delete now runs BEFORE the storage delete -- reversing the order the
 * S5R4-AUTHZ-B1 fix above left in place, which still had one residual
 * race: a concurrent, fully legitimate VERIFY landing strictly BETWEEN
 * the OLD storage delete and the OLD metadata delete committed while
 * the evidence_files row still existed, so evidence_storage_delete_
 * own_org's own live check (there must be no evidence_files row citing
 * this object under a VERIFIED parent) still permitted the storage
 * delete that had already run moments earlier -- and then evidence_
 * files_delete_own_org correctly refused the metadata delete (the
 * parent was now VERIFIED), stranding a metadata row that cites a
 * storage object no longer there: a "zombie" evidence file, live and
 * visible in the producer's own evidence list, silently
 * un-downloadable. Live-reproduced end to end (real psql BEGIN...
 * ROLLBACK, impersonating a real MEMBER and a real ADMIN of the same
 * org): the ordering race reproduced exactly as described.
 *
 * Deleting the metadata row first closes it by construction rather
 * than by timing: evidence_storage_delete_own_org's own guard is keyed
 * on an evidence_files row citing this exact storage_path still
 * existing, so once that row is gone a VERIFY committing at any point
 * afterward has nothing left to strand -- there is no citing row left
 * for the storage delete that follows to leave dangling. A zero-rows
 * metadata delete (the same PostgREST-reports-no-error-on-an-RLS-
 * filtered-DELETE hazard manage-membership.ts:236-243 already guards
 * against) is genuinely ambiguous, not uniquely explained by a
 * concurrent VERIFY: remove_evidence_file_id is a plain idempotent
 * array_remove UPDATE, so the array update above succeeding rules out
 * nothing about whether a SECOND, independent removeEvidenceFile call
 * for the same evidenceFileId already deleted the row moments earlier
 * (two org members, or two tabs of the same admin, racing the same
 * evidence row -- this function's several sequential round-trips leave
 * a real window for that). 2026-09-07 (S5 review round 6, finding
 * S5R6-AUTHZ-1, live-reproduced): the original S5R5-AUTHZ-Y2 fix
 * assumed the array update's success ruled this out and reported every
 * zero-rows outcome as EMISSION_DATA_VERIFIED unconditionally; a race
 * loser's verification_status was confirmed UNVERIFIED throughout. Now
 * disambiguated with one more read (evidence_files_select_own_org
 * carries no verification_status clause, so it still finds the row iff
 * it still exists): EMISSION_DATA_VERIFIED only when the row is
 * confirmed still present, NOT_FOUND when it's confirmed gone, and the
 * generic PERSIST_FAILED -- the sibling pattern this code originally
 * cited as its origin (manage-membership.ts:236-243) -- when that
 * follow-up read itself fails and the cause genuinely can't be known.
 *
 * The storage delete that follows a successful metadata delete is
 * best-effort: by that point the record no longer cites this file at
 * all (both the array update and the metadata row are already gone),
 * so removal has already fully succeeded from the record's own point
 * of view, and a failure to reclaim the underlying bytes only leaks
 * storage -- it can never again strand a citation, because the row
 * that would have cited it is already deleted. Matches
 * uploadEvidenceFile's own documented "best-effort by design" posture
 * for compensating actions elsewhere in this file.
 *
 * Concurrent removal/upload races against the array update itself
 * remain closed by construction (a single atomic `array_remove`
 * UPDATE, so two concurrent writers serialize at the row level instead
 * of overwriting each other -- the class of bug a P13 audit round
 * partially closed with a retry, and an S5 audit round closed fully
 * with this same RPC).
 */
export async function removeEvidenceFile(
  supabase: SupabaseClient,
  context: OrgContext,
  evidenceFileId: EvidenceFileId,
): Promise<RemoveEvidenceFileResult> {
  // 2026-09-06 (S5 review remediation round 2, finding S5R2-COMPOSE-B1).
  // Same widening as uploadEvidenceFile above, for the identical reason
  // -- see that function's own doc comment.
  if (!mayManageOwnInstallationRecords(context)) {
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

  const ownership =
    await fetchOwnedEmissionDataForEvidence(
      supabase,
      orgId,
      fetched.file.emission_data_id,
    );

  // Fail CLOSED. This read exists to answer "is the parent VERIFIED?",
  // and the VERIFIED lock is an integrity lock -- evidence behind a
  // completed verification must not be destroyable. When the read
  // ERRORS we do not know the answer, so the only safe answer is no.
  //
  // Previously this was folded into the conjunct below, so an errored
  // read made the condition false, skipped the guard, and let the
  // deletion proceed on a record that might well have been VERIFIED.
  // uploadEvidenceFile fails closed against this same helper (see its
  // `if (ownership.status === "REJECTED") return ownership;`); only the
  // removal path diverged. (P13 final round, 2026-08-31.)
  if (ownership.status === "REJECTED") {
    // Mapped explicitly rather than widening RemoveEvidenceFileResult to
    // carry EMISSION_DATA_NOT_FOUND: this caller is removing a file, and
    // "the record it hangs off isn't there" is a NOT_FOUND from its point
    // of view, not a distinct outcome it could act on differently.
    // (In practice that branch is unreachable -- evidence_files
    // .emission_data_id is NOT NULL with an FK, and both tables' select
    // policies key on the same app.user_org_ids() -- but it is modelled
    // rather than assumed away.)
    return {
      status: "REJECTED",
      reason:
        ownership.reason === "EMISSION_DATA_NOT_FOUND"
          ? "NOT_FOUND"
          : "PERSIST_FAILED",
    };
  }

  if (ownership.verificationStatus === "VERIFIED") {
    return {
      status: "REJECTED",
      reason: "EMISSION_DATA_VERIFIED",
    };
  }

  // 2026-09-07 (S5 review round 4, finding S5R4-AUTHZ-B1). Moved to run
  // FIRST, before either delete -- see this function's own doc comment
  // for why. Any error here is treated as EMISSION_DATA_VERIFIED: the
  // only realistic failure mode for a single-row array_remove UPDATE
  // against a row `fetched`/`ownership` just confirmed this org owns is
  // app.enforce_emission_data_verification_gate's live "evidence cannot
  // shrink from a VERIFIED record" rule firing because a concurrent
  // VERIFY committed between the in-memory check above and this
  // statement -- exactly the race this reordering exists to close.
  const { error: arrayUpdateError } =
    await supabase
      .rpc(
        "remove_evidence_file_id",
        {
          p_emission_data_id: fetched.file.emission_data_id,
          p_evidence_file_id: evidenceFileId,
        },
      );

  if (arrayUpdateError) {
    return {
      status: "REJECTED",
      reason: "EMISSION_DATA_VERIFIED",
    };
  }

  // 2026-09-07 (S5 review round 5, finding S5R5-AUTHZ-Y2). Runs BEFORE
  // the storage delete now -- see this function's own doc comment for
  // the full ordering rationale and the exact race this closes. Same
  // .select("id") + zero-rows guard manage-membership.ts:236-243
  // already applies to its own DELETE, for the identical reason:
  // PostgREST reports NO error for a DELETE that RLS filters to zero
  // rows, so `deleteError` alone cannot distinguish "deleted" from
  // "silently refused."
  const { data: deleted, error: deleteError } =
    await supabase
      .from("evidence_files")
      .delete()
      .eq("id", evidenceFileId)
      .select("id");

  if (deleteError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!deleted || deleted.length === 0) {
    // 2026-09-07 (S5 review round 6, finding S5R6-AUTHZ-1). A zero-rows
    // metadata delete is genuinely ambiguous, and this branch used to
    // pick the wrong cause unconditionally: either (a) a concurrent
    // VERIFY made evidence_files_delete_own_org's own
    // `verification_status <> 'VERIFIED'` clause filter this DELETE, or
    // (b) the row was already deleted by a second, independent
    // removeEvidenceFile call whose own DELETE won the race -- two org
    // members, or two tabs of the same admin, both clicking Remove on
    // the same evidence row within the same short window (this function
    // makes several sequential round-trips before its own delete, so
    // both callers can pass every earlier check before either deletes).
    // remove_evidence_file_id is a plain idempotent array_remove UPDATE,
    // so the array-update succeeding just above rules out nothing about
    // which of these two caused THIS specific zero-rows result -- the
    // premise the original S5R5-AUTHZ-Y2 fix relied on. Live-
    // reproduced (real psql, two callers racing the full real statement
    // sequence): the loser's verification_status was confirmed
    // UNVERIFIED throughout, yet this branch would have told them
    // otherwise.
    //
    // Disambiguate with one more read: evidence_files_select_own_org
    // (unlike the DELETE policy) carries no verification_status clause
    // at all, so it still finds the row if -- and only if -- it still
    // exists. A row that's gone means a concurrent removal won the
    // race, not a VERIFIED lock -- NOT_FOUND is both true and matches
    // the exact reason this function already returns for "no such
    // evidence file" everywhere else. Only a row that's still there
    // (SELECT succeeds, DELETE didn't) proves the VERIFIED cause. A
    // genuine error on this follow-up read means the cause is unknown,
    // so it falls back to the same generic, non-accusatory
    // PERSIST_FAILED the sibling pattern this code cites as its origin
    // (manage-membership.ts:236-243) deliberately stays with for an
    // indistinguishable zero-rows cause.
    const stillPresent =
      await fetchOwnedEvidenceFile(
        supabase,
        orgId,
        evidenceFileId,
      );

    if (stillPresent.status === "OK") {
      return {
        status: "REJECTED",
        reason: "EMISSION_DATA_VERIFIED",
      };
    }

    return {
      status: "REJECTED",
      reason:
        stillPresent.reason === "NOT_FOUND"
          ? "NOT_FOUND"
          : "PERSIST_FAILED",
    };
  }

  // Best-effort from here on: see this function's own doc comment for
  // why a failure to reclaim the storage bytes is never surfaced as a
  // rejection once the metadata row (and its citation, via the array
  // update above) are already gone.
  await supabase.storage
    .from(EVIDENCE_STORAGE_BUCKET)
    .remove(
      [fetched.file.storage_path],
    );

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
 * first. The UI groups these by emission_data_id client-side rather
 * than this function taking an emissionDataId filter, so one screen
 * render needs one query instead of one per record.
 *
 * 2026-09-07 (supabase/config.toml `max_rows = 1000`; S5 review round
 * 5, finding S5R5-SHARE-EVID-01). Paged with .range() -- an org's
 * evidence_files only grows over time (files are removed individually,
 * never bulk-purged), so a long-lived producer eventually crosses
 * PostgREST's row cap. The completeness gate itself
 * (checkEmissionDataEvidenceCompleteness, get-buyer-view.ts's
 * countEvidenceFiles) is unaffected -- both read emission_data.
 * evidence_file_ids, a separate column -- but this function's own
 * caller-facing file LIST is what a producer's ADMIN/OWNER actually
 * opens to review evidence before deciding VERIFY/REJECT
 * (evidence-section.tsx); a truncated result silently shows fewer
 * files than genuinely exist, with no signal anything was dropped.
 */
const EVIDENCE_FILES_PAGE_SIZE =
  1000;

export async function listEvidenceFiles(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<EvidenceFile[]> {
  const rows: EvidenceFileRow[] =
    [];

  let offset =
    0;

  for (;;) {
    const { data, error } =
      await supabase
        .from("evidence_files")
        .select(
          EVIDENCE_FILES_COLUMNS,
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        // `id` as a deterministic tie-breaker so .range() pagination
        // stays stable across pages sharing a created_at value.
        .order("id", { ascending: false })
        .range(offset, offset + EVIDENCE_FILES_PAGE_SIZE - 1);

    // 2026-09-07 (S5 review round 3, finding S5R3-EMPTY-B2). THROWS on
    // a genuine query error rather than degrading to [] -- both
    // callers (app/(producer)/emission-data/page.tsx, app/(importer)/
    // external-emissions/page.tsx) are plain server components with
    // no try/catch of their own, so this reaches app/error.tsx the
    // same way every other sibling fixed this same S5 phase does. A
    // transport failure previously rendered as "no evidence files" --
    // a false all-clear on the exact records a producer/importer
    // relies on for verification.
    if (error) {
      throw new Error(
        `upload-evidence: evidence_files fetch failed (${error.message}).`,
      );
    }

    const page =
      (data ?? []) as EvidenceFileRow[];

    rows.push(
      ...page,
    );

    if (page.length < EVIDENCE_FILES_PAGE_SIZE) {
      break;
    }

    offset +=
      EVIDENCE_FILES_PAGE_SIZE;
  }

  return rows.map(
    toEvidenceFile,
  );
}
