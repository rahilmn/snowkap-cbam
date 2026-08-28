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

export const dynamic =
  "force-dynamic";

interface UploadEvidenceResponseBody {
  success: boolean;
  reason?: string;
  fileId?: string;
}

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
