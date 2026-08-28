import "server-only";

import {
  NextResponse,
} from "next/server";

import {
  getServerSupabaseClient,
} from "../../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../../components/shell/get-preferred-org-id";

import {
  getEvidenceDownloadUrl,
} from "../../../../../src/application/evidence/upload-evidence";

export const dynamic =
  "force-dynamic";

interface DownloadErrorBody {
  success: false;
  reason: string;
}

/**
 * GET -- verifies the caller's active org owns this evidence file
 * (getEvidenceDownloadUrl), then redirects to a short-lived signed
 * Supabase Storage URL. The sanctioned app/api/** exception for
 * downloads (CLAUDE.md) -- this route never streams the file's bytes
 * through the Node process itself, only issues a 307 redirect to
 * Storage's own signed-URL endpoint, so a plain `<a href="/api/evidence/{id}/download">`
 * (see evidence-section.tsx) works as an ordinary download link.
 *
 * Ownership is checked BEFORE any URL is generated -- a cross-org
 * caller gets 404, never a signed URL for someone else's file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<DownloadErrorBody> | Response> {
  const { id } =
    await params;

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

  const result =
    await getEvidenceDownloadUrl(
      supabase,
      orgSummary.context.org_id,
      id as never,
    );

  if (result.status === "REJECTED") {
    return NextResponse.json(
      { success: false, reason: result.reason },
      { status: result.reason === "NOT_FOUND" ? 404 : 500 },
    );
  }

  return NextResponse.redirect(
    result.signedUrl,
  );
}
