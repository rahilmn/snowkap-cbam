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

import {
  createInMemoryRateLimiter,
} from "../../../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../../../components/shell/get-client-ip";

export const dynamic =
  "force-dynamic";

interface DownloadErrorBody {
  success: false;
  reason: string;
  retryAfterSeconds?: number;
}

/**
 * Each successful call generates a fresh short-lived signed Storage
 * URL and every call (successful or not) exercises the ownership check
 * against a caller-supplied `id` -- lighter per-request cost than the
 * upload route (no body to buffer/validate), but still worth bounding
 * against an attacker enumerating evidence-file IDs to probe for a 307
 * (exists, and this org can reach it) vs a 404. More generous than
 * evidenceUploadLimiter (app/api/evidence/upload/route.ts's own
 * 20/5min) since reviewing several attached evidence files in one
 * sitting is ordinary use, not a signal of abuse the way 20+ uploads
 * in 5 minutes would be.
 */
const EVIDENCE_DOWNLOAD_RATE_LIMIT =
  {
    limit: 60,
    windowMs: 5 * 60 * 1000,
  };

const evidenceDownloadLimiter =
  createInMemoryRateLimiter(
    EVIDENCE_DOWNLOAD_RATE_LIMIT,
  );

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
  const rateLimitResult =
    evidenceDownloadLimiter.check(
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
      { status: 429 },
    );
  }

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
