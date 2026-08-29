import "server-only";

import {
  NextResponse,
} from "next/server";

import {
  revalidatePath,
} from "next/cache";

import {
  getServerSupabaseClient,
} from "../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../components/shell/get-preferred-org-id";

import {
  uploadEvidenceFile,
} from "../../../../src/application/evidence/upload-evidence";

import {
  MAX_EVIDENCE_FILE_SIZE_BYTES,
} from "../../../../src/domain/evidence/validate-evidence-upload";

import {
  createInMemoryRateLimiter,
} from "../../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../../components/shell/get-client-ip";

export const dynamic =
  "force-dynamic";

interface UploadEvidenceResponseBody {
  success: boolean;
  reason?: string;
  fileId?: string;
  retryAfterSeconds?: number;
}

/**
 * Uploads are heavier than a form POST -- each attempt streams a file
 * body, runs upload-evidence.ts's own validation (size/MIME/extension
 * checks) against the real bytes, and on success writes to Supabase
 * Storage plus a DB row -- so this is deliberately tighter than the
 * sign-up limit above it in cost-per-attempt terms, but still needs
 * enough headroom for a real producer attaching several evidence
 * files to one emission-data record in a single sitting (see
 * evidence-section.tsx's own multi-file upload flow). 20 uploads per
 * 5 minutes per IP.
 *
 * Checked here, before getServerSupabaseClient()/getUser() below --
 * same "reject before any I/O" ordering as
 * app/(auth)/actions.ts and app/accept-invitation/actions.ts use, so
 * a rate-limited caller never reaches Supabase, let alone Storage.
 * Keyed on IP alone (not IP+user) for that same reason: the caller's
 * identity isn't known yet at the point this check has to run.
 */
const EVIDENCE_UPLOAD_RATE_LIMIT =
  {
    limit: 20,
    windowMs: 5 * 60 * 1000,
  };

const evidenceUploadLimiter =
  createInMemoryRateLimiter(
    EVIDENCE_UPLOAD_RATE_LIMIT,
  );

/**
 * 2026-08-29 (P11 mandatory security review, finding #13, SHOULD-FIX,
 * confirmed live): request.formData() (further below) fully buffers
 * the ENTIRE request body -- multipart framing plus the file itself
 * -- into memory before validateEvidenceUpload ever sees
 * fileBytes.byteLength. Route Handlers carry no default body-size cap
 * the way Next's serverActions.bodySizeLimit does for Server Actions
 * (node_modules/next/dist/docs/.../serverActions.md's own scope note
 * -- confirmed by reading it, not assumed), and next.config.ts sets
 * none either. Live repro: a 2 GB POST body is fully read into memory
 * before this handler ever returns 413. A small overhead allowance
 * above the real file-size cap accounts for multipart boundary/header
 * framing around the file part -- generous enough to never reject a
 * legitimately-sized upload, nowhere near enough to matter for the
 * attack this closes (a multi-hundred-MB-to-GB body).
 */
const MULTIPART_FRAMING_OVERHEAD_BYTES =
  64 * 1024;

const MAX_ACCEPTABLE_CONTENT_LENGTH_BYTES =
  MAX_EVIDENCE_FILE_SIZE_BYTES + MULTIPART_FRAMING_OVERHEAD_BYTES;

/**
 * HTTP status for each application-layer rejection reason -- 4xx for
 * everything the caller could in principle fix by sending a different
 * request (wrong record, disallowed file, too large), 5xx only for the
 * two reasons that mean storage/DB I/O itself failed.
 */
function statusForUploadRejection(
  reason: string,
): number {
  switch (reason) {
    case "EMISSION_DATA_NOT_FOUND":
      return 404;

    case "FILE_TOO_LARGE":
      return 413;

    case "DISALLOWED_MIME_TYPE":
    case "DISALLOWED_EXTENSION":
    case "MIME_EXTENSION_MISMATCH":
    case "EXECUTABLE_EXTENSION":
      return 415;

    case "EMPTY_FILE":
      return 400;

    // Not an upload-evidence.ts application-layer reason (those are
    // all handled above) -- this route's own rate-limit rejection,
    // mapped here anyway so every non-2xx status this handler can
    // return has exactly one place computing it.
    case "RATE_LIMITED":
      return 429;

    default:
      return 500;
  }
}

/**
 * POST multipart/form-data: `emissionDataId` + `file`. The sanctioned
 * app/api/** exception for uploads (CLAUDE.md; layering.test.ts
 * exempts app/api/** from the UI-must-not-import-infrastructure-
 * directly rule for exactly this reason) -- multipart handling is
 * awkward through a Server Action (see
 * app/(producer)/emission-data/evidence-section.tsx's own comment on
 * why this is a client component posting via fetch()), and this is
 * where the actual upload-safety enforcement
 * (src/application/evidence/upload-evidence.ts) genuinely runs against
 * the uploaded bytes, not just documented as a rule.
 *
 * The caller's OrgContext is derived server-side from the session
 * (getCurrentOrgSummary, same as every Server Action on this screen)
 * -- there is deliberately no "orgId" form field this route ever
 * reads, so a client can never claim to be uploading on behalf of an
 * org it doesn't actually belong to.
 */
export async function POST(
  request: Request,
): Promise<NextResponse<UploadEvidenceResponseBody>> {
  const rateLimitResult =
    evidenceUploadLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        reason: "RATE_LIMITED",
        retryAfterSeconds:
          Math.ceil(rateLimitResult.retryAfterMs / 1000),
      },
      { status: statusForUploadRejection("RATE_LIMITED") },
    );
  }

  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, reason: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return NextResponse.json(
      { success: false, reason: "NO_ORGANIZATION" },
      { status: 403 },
    );
  }

  // 2026-08-29 (P11 finding #13): reject on Content-Length BEFORE
  // request.formData() below ever buffers a single byte of the body
  // -- see MAX_ACCEPTABLE_CONTENT_LENGTH_BYTES's own comment. Only
  // guards the common case where the client sends Content-Length at
  // all (every real browser fetch()/FormData upload does, since the
  // File's size is known synchronously) -- a request using chunked
  // transfer-encoding with no Content-Length still falls through to
  // the existing post-buffer FILE_TOO_LARGE check below, which is a
  // real but narrower residual than the one this closes.
  const contentLengthHeader =
    request.headers.get(
      "content-length",
    );

  if (contentLengthHeader) {
    const contentLength =
      Number(contentLengthHeader);

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_ACCEPTABLE_CONTENT_LENGTH_BYTES
    ) {
      return NextResponse.json(
        { success: false, reason: "FILE_TOO_LARGE" },
        { status: statusForUploadRejection("FILE_TOO_LARGE") },
      );
    }
  }

  let formData: FormData;

  try {
    formData =
      await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, reason: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const emissionDataId =
    formData.get("emissionDataId");

  const file =
    formData.get("file");

  if (
    typeof emissionDataId !== "string" ||
    emissionDataId.length === 0 ||
    !(file instanceof File)
  ) {
    return NextResponse.json(
      { success: false, reason: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const fileBytes =
    new Uint8Array(
      await file.arrayBuffer(),
    );

  const result =
    await uploadEvidenceFile(
      supabase,
      orgSummary.context.org_id,
      user.id as never,
      {
        emissionDataId: emissionDataId as never,
        fileName: file.name,
        // A missing/empty client-reported MIME type can never
        // coincidentally match the allowlist, so this just gives a
        // stable, non-empty value to validate/log rather than "".
        mimeType: file.type || "application/octet-stream",
        fileBytes,
      },
    );

  if (result.status === "REJECTED") {
    return NextResponse.json(
      { success: false, reason: result.reason },
      { status: statusForUploadRejection(result.reason) },
    );
  }

  revalidatePath(
    "/emission-data",
  );

  return NextResponse.json(
    { success: true, fileId: result.file.id },
    { status: 200 },
  );
}
