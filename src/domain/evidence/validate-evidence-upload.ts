/**
 * Pure, side-effect-free upload-safety validation for an evidence
 * file, before a single byte reaches storage -- see
 * src/application/evidence/upload-evidence.ts, which calls this
 * BEFORE any storage/DB I/O, and
 * docs/plans/MASTER_PLAN.md's upload-safety-minimums requirement
 * (MIME + extension allowlists, size cap, non-executable handling)
 * for why every one of these checks exists.
 *
 * The MIME allowlist and the extension allowlist are checked
 * INDEPENDENTLY of each other, then cross-validated for agreement --
 * a client-supplied MIME type (e.g. an XHR/fetch `Content-Type` or a
 * multipart field) can be spoofed by the caller, so trusting it alone
 * would let a caller claim "application/pdf" for a file named
 * "payload.exe". Requiring BOTH the MIME type and the extension to
 * independently pass their own allowlist, AND agree with each other,
 * closes that gap without needing real file-content sniffing (magic
 * bytes) in this slice.
 *
 * The executable-extension check runs FIRST and unconditionally --
 * defense in depth against a hypothetical future MIME-allowlist
 * mistake, or an executable-associated extension that happens to
 * collide with an allowlisted one; see this module's own
 * EXECUTABLE_EXTENSIONS set.
 */

export const MAX_EVIDENCE_FILE_SIZE_BYTES =
  20 * 1024 * 1024;

/**
 * MIME type -> the extension(s) that legitimately correspond to it.
 * Keep in sync with evidence_files' own documentation
 * (supabase/migrations/20260829240000_p7c_evidence_files_schema.sql)
 * and the task's explicit allowlist -- this is the single source of
 * truth for both the MIME allowlist and the extension allowlist (the
 * union of all values below).
 */
const ALLOWED_MIME_TYPE_EXTENSIONS: Record<string, readonly string[]> =
  {
    "application/pdf": [".pdf"],
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  };

const ALLOWED_EXTENSIONS =
  new Set(
    Object.values(
      ALLOWED_MIME_TYPE_EXTENSIONS,
    ).flat(),
  );

/**
 * Rejected unconditionally, even if somehow paired with an
 * allowlisted MIME type -- see this module's own doc comment.
 */
const EXECUTABLE_EXTENSIONS =
  new Set(
    [".exe", ".sh", ".bat", ".cmd", ".ps1", ".dll", ".app", ".scr", ".js", ".msi"],
  );

export type EvidenceUploadRejectionReason =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "EXECUTABLE_EXTENSION"
  | "DISALLOWED_MIME_TYPE"
  | "DISALLOWED_EXTENSION"
  | "MIME_EXTENSION_MISMATCH";

export type ValidateEvidenceUploadResult =
  | { status: "OK"; extension: string }
  | { status: "REJECTED"; reason: EvidenceUploadRejectionReason };

export interface ValidateEvidenceUploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Lowercased extension INCLUDING the leading dot (e.g. ".pdf"), taken
 * from the LAST "." in the filename -- "archive.tar.gz" is treated as
 * a ".gz" file, not a ".tar" one, matching how a filesystem/shell
 * would resolve it. Returns "" when there is no extension at all
 * (e.g. "no-extension-at-all", or a filename ending in a bare "."),
 * which never matches any allowlist entry and so is rejected as
 * DISALLOWED_EXTENSION downstream.
 */
function extractExtension(
  fileName: string,
): string {
  const trimmed =
    fileName.trim();

  const lastDot =
    trimmed.lastIndexOf(
      ".",
    );

  if (lastDot === -1 || lastDot === trimmed.length - 1) {
    return "";
  }

  return trimmed
    .slice(
      lastDot,
    )
    .toLowerCase();
}

export function validateEvidenceUpload(
  input: ValidateEvidenceUploadInput,
): ValidateEvidenceUploadResult {
  const extension =
    extractExtension(
      input.fileName,
    );

  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    return {
      status: "REJECTED",
      reason: "EXECUTABLE_EXTENSION",
    };
  }

  if (input.sizeBytes <= 0) {
    return {
      status: "REJECTED",
      reason: "EMPTY_FILE",
    };
  }

  if (input.sizeBytes > MAX_EVIDENCE_FILE_SIZE_BYTES) {
    return {
      status: "REJECTED",
      reason: "FILE_TOO_LARGE",
    };
  }

  const extensionsForMimeType =
    ALLOWED_MIME_TYPE_EXTENSIONS[input.mimeType];

  if (!extensionsForMimeType) {
    return {
      status: "REJECTED",
      reason: "DISALLOWED_MIME_TYPE",
    };
  }

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return {
      status: "REJECTED",
      reason: "DISALLOWED_EXTENSION",
    };
  }

  if (!extensionsForMimeType.includes(extension)) {
    return {
      status: "REJECTED",
      reason: "MIME_EXTENSION_MISMATCH",
    };
  }

  return {
    status: "OK",
    extension,
  };
}
